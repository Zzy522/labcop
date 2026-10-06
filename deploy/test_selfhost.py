import argparse
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sqlite3
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('selfhost', Path(__file__).with_name('selfhost.py'))
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)


class SelfHostTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.root.joinpath('package.json').write_text('{}')
        self.root.joinpath('Dockerfile').write_text('FROM node:24-slim')
        self.args = argparse.Namespace(mode='local', url=None, port=3000, admin_email='admin@example.org',
            app_image=None, migrator_image=None, release=None, non_interactive=True)

    def tearDown(self):
        self.temp.cleanup()

    def init(self):
        with contextlib.redirect_stdout(io.StringIO()):
            host.initialize(self.root, self.args)

    def database(self):
        path = self.root / '.selfhost/data/lab.db'
        with contextlib.closing(sqlite3.connect(path)) as db:
            with db:
                db.execute('CREATE TABLE sample (id INTEGER PRIMARY KEY, name TEXT)')
                db.execute("INSERT INTO sample VALUES (1, 'example')")
        return path

    def test_init_preserves_existing_production_config(self):
        production = self.root / '.env'
        production.write_text('PRODUCTION=untouched')
        self.init()
        self.assertEqual(production.read_text(encoding='utf-8'), 'PRODUCTION=untouched')
        env = host.read_env(self.root)
        self.assertGreaterEqual(len(env['PLATFORM_ADMIN_PASSWORD']), 16)
        self.assertEqual(env['AUTH_COOKIE_SECURE'], 'false')
        self.assertEqual(len(host.base64.b64decode(env['CREDENTIAL_ENCRYPTION_KEY'])), 32)

    def test_reinitialization_does_not_rotate_secrets(self):
        self.init()
        before = (self.root / '.selfhost/app.env').read_bytes()
        with self.assertRaises(RuntimeError):
            self.init()
        self.assertEqual((self.root / '.selfhost/app.env').read_bytes(), before)

    def test_password_not_printed(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            host.initialize(self.root, self.args)
        self.assertNotIn(host.read_env(self.root)['PLATFORM_ADMIN_PASSWORD'], output.getvalue())

    def test_local_binds_only_loopback(self):
        self.init()
        compose = (self.root / '.selfhost/compose.yaml').read_text(encoding='utf-8')
        self.assertIn('127.0.0.1:3000:3000', compose)
        self.assertIn('format: raw', compose)
        self.assertNotIn('gateway:', compose)

    def test_public_rejects_ip_http_and_embedded_credentials(self):
        for url in ('http://lab.example.org', 'https://127.0.0.1', 'https://a:b@lab.example.org', 'https://lab.example.org/path'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                host.validate_url('public', url, 3000)

    def test_lan_uses_internal_ca_and_no_public_app_port(self):
        self.args.mode = 'lan'
        self.args.url = 'https://192.168.1.20'
        self.init()
        state = self.root / '.selfhost'
        self.assertIn('tls internal', (state / 'Caddyfile').read_text(encoding='utf-8'))
        self.assertNotIn('3000:3000', (state / 'compose.yaml').read_text(encoding='utf-8'))
        with self.assertRaises(ValueError):
            host.validate_config(self.root)

    def test_nonlocal_requires_smtp_and_secure_cookie(self):
        self.args.mode = 'public'
        self.args.url = 'https://lab.example.org'
        self.init()
        with self.assertRaises(ValueError):
            host.validate_config(self.root)
        path = self.root / '.selfhost/app.env'
        path.write_text(path.read_text(encoding='utf-8').replace('SMTP_HOST=\n', 'SMTP_HOST=smtp.example.org\n'), encoding='utf-8')
        host.validate_config(self.root)

    def test_raw_env_keeps_dollar_hash_and_quotes(self):
        self.init()
        path = self.root / '.selfhost/app.env'
        path.write_text(path.read_text(encoding='utf-8').replace('SMTP_PASS=\n', 'SMTP_PASS=a$B#c"d\n'), encoding='utf-8')
        self.assertEqual(host.read_env(self.root)['SMTP_PASS'], 'a$B#c"d')

    def test_lock_refuses_overlapping_operation(self):
        self.init()
        with host.operation_lock(self.root):
            with self.assertRaises(RuntimeError):
                with host.operation_lock(self.root):
                    pass
        self.assertFalse((self.root / '.selfhost/operation.lock').exists())

    def test_migration_failure_does_not_start_app(self):
        self.init()
        settings = host.load(self.root)
        settings['source_build'] = False
        (self.root / '.selfhost/settings.json').write_text(json.dumps(settings))
        calls = []
        def fake_compose(root, *args, **kwargs):
            calls.append(args)
            if args[:2] == ('up', '--force-recreate'):
                raise RuntimeError('migration failed')
        with patch.object(host, 'check_docker'), patch.object(host, 'compose', side_effect=fake_compose):
            with self.assertRaises(RuntimeError):
                host.start(self.root)
        self.assertIn(('stop', 'app'), calls)
        self.assertFalse(any(call[:2] == ('up', '-d') for call in calls))

    def make_backup(self):
        self.init()
        self.database()
        calls = []
        def fake_compose(root, *args, **kwargs):
            calls.append(args)
            return argparse.Namespace(stdout='app\n')
        with patch.object(host, 'compose', side_effect=fake_compose), contextlib.redirect_stdout(io.StringIO()):
            archive = host.backup(self.root)
        self.assertIn(('stop', 'app'), calls)
        self.assertIn(('start', 'app'), calls)
        return archive

    def test_backup_restore_roundtrip_preserves_keys_and_data(self):
        archive = self.make_backup()
        target = self.root / 'new-checkout'
        target.mkdir()
        old_key = host.read_env(self.root)['CREDENTIAL_ENCRYPTION_KEY']
        with contextlib.redirect_stdout(io.StringIO()):
            host.restore(target, archive)
        self.assertEqual(host.read_env(target)['CREDENTIAL_ENCRYPTION_KEY'], old_key)
        with contextlib.closing(sqlite3.connect(target / '.selfhost/data/lab.db')) as db:
            self.assertEqual(db.execute('SELECT name FROM sample').fetchone(), ('example',))
        self.assertIn((target / '.selfhost/data').as_posix(), (target / '.selfhost/compose.yaml').read_text(encoding='utf-8'))

    def test_restore_refuses_existing_data(self):
        archive = self.make_backup()
        with self.assertRaises(RuntimeError):
            host.restore(self.root, archive)
        host.database_check(self.root / '.selfhost/data/lab.db')

    def test_restore_rejects_tampered_archive(self):
        archive = self.make_backup()
        archive.write_bytes(archive.read_bytes() + b'tamper')
        target = self.root / 'new-checkout'
        target.mkdir()
        with self.assertRaises(RuntimeError):
            host.restore(target, archive)
        self.assertFalse((target / '.selfhost').exists())

    def test_restore_rejects_archive_path_traversal(self):
        archive = self.root / 'unsafe.tar.gz'
        with tarfile.open(archive, 'w:gz') as tar:
            item = tarfile.TarInfo('.selfhost/../../outside.txt')
            item.size = 1
            tar.addfile(item, io.BytesIO(b'x'))
        archive.with_suffix('.gz.sha256').write_text(host.hash_file(archive))
        target = self.root / 'new-checkout'
        target.mkdir()
        with self.assertRaises(RuntimeError):
            host.restore(target, archive)
        self.assertFalse((self.root / 'outside.txt').exists())

    def test_backup_failure_restarts_previously_running_app(self):
        self.init()
        calls = []
        def fake_compose(root, *args, **kwargs):
            calls.append(args)
            return argparse.Namespace(stdout='app\n')
        with patch.object(host, 'compose', side_effect=fake_compose):
            with self.assertRaises(RuntimeError):
                host.backup(self.root)
        self.assertIn(('start', 'app'), calls)

    def test_lan_health_uses_caddy_data_ca_and_validates_https(self):
        self.args.mode = 'lan'
        self.args.url = 'https://192.168.1.20'
        self.init()
        ca = self.root / '.selfhost/caddy-data/caddy/pki/authorities/local/root.crt'
        ca.parent.mkdir(parents=True)
        ca.write_text('certificate fixture')
        response = io.BytesIO(b'{"status":"ok"}')
        with (patch.object(host, 'compose', return_value=argparse.Namespace(stdout='container-id')),
              patch.object(host, 'run', return_value=argparse.Namespace(stdout='healthy')),
              patch.object(host.ssl, 'create_default_context') as context,
              patch.object(host.urllib.request, 'urlopen', return_value=response) as request,
              contextlib.redirect_stdout(io.StringIO())):
            host.wait_ready(self.root, host.load(self.root))
        context.assert_called_once_with(cafile=str(ca))
        self.assertEqual(request.call_args.args[0], 'https://192.168.1.20/api/health')
        self.assertEqual(request.call_args.kwargs['context'], context.return_value)


if __name__ == '__main__':
    unittest.main()
