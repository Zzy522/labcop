#!/usr/bin/env python3
"""Cross-platform single-instance self-hosting. Python 3.9+, Docker Compose 2.30+.

Configuration and data live only in .selfhost, independent of production .env/data.
No shell evaluation, automatic system installation, destructive database seed or reset.
"""
import argparse
import base64
from contextlib import closing, contextmanager
from datetime import datetime, timezone
import getpass
import hashlib
import ipaddress
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import shutil
import sqlite3
import ssl
import subprocess
import sys
import tarfile
import tempfile
import time
from urllib.parse import urlparse
import urllib.request

ROOT = Path(__file__).resolve().parent.parent


def run(command, root, capture=False):
    return subprocess.run([str(value) for value in command], cwd=root, check=True,
                          stdout=subprocess.PIPE if capture else None, text=capture,
                          encoding='utf-8' if capture else None)


def state_dir(root):
    return root / '.selfhost'


def hash_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as file:
        for block in iter(lambda: file.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def load(root):
    return json.loads((state_dir(root) / 'settings.json').read_text(encoding='utf-8'))


def compose(root, *args, capture=False):
    settings = load(root)
    return run(['docker', 'compose', '-p', settings['project'], '--project-directory', root,
                '-f', state_dir(root) / 'compose.yaml', *args], root, capture)


def check_docker(root):
    if not shutil.which('docker'):
        raise RuntimeError('未找到 Docker。先安装并启动 Docker，再重新打开终端。')
    run(['docker', 'info'], root, capture=True)
    result = run(['docker', 'compose', 'version', '--short'], root, capture=True).stdout
    match = re.search(r'(\d+)\.(\d+)', result)
    if not match or tuple(map(int, match.groups())) < (2, 30):
        raise RuntimeError('需要 Docker Compose 2.30+（用于原样读取含 $ 的密钥）。')


def validate_url(mode, url, port):
    parsed = urlparse(url)
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/'):
        raise ValueError('访问地址只能包含协议、主机和端口，不得包含账号、路径或参数。')
    if not parsed.hostname or not re.fullmatch(r'[A-Za-z0-9.-]+', parsed.hostname):
        raise ValueError('请输入 IPv4 地址或英文域名；当前快捷入口不支持 IPv6 或中文域名。')
    if not 1 <= port <= 65535:
        raise ValueError('端口应为 1–65535。')
    if mode == 'local':
        if parsed.scheme != 'http' or parsed.hostname not in ('localhost', '127.0.0.1') or parsed.port != port:
            raise ValueError('本机模式使用 http://localhost:端口 或 http://127.0.0.1:端口。')
    else:
        if parsed.scheme != 'https':
            raise ValueError('校内、公网和已有代理模式必须使用 HTTPS。')
        if mode in ('lan', 'public') and parsed.port not in (None, 443):
            raise ValueError('自动 HTTPS 网关使用 443 端口。')
    if mode == 'public':
        try:
            ipaddress.ip_address(parsed.hostname)
        except ValueError:
            if '.' not in parsed.hostname or parsed.hostname.endswith(('.local', '.localhost', '.invalid')):
                raise ValueError('公网模式需要可以解析到服务器的公开域名。')
        else:
            raise ValueError('公网快捷模式请使用域名；IP 或校内地址请选择 lan。')
    return url.rstrip('/')


def write_private(path, content):
    with path.open('x', encoding='utf-8', newline='\n') as file:
        file.write(content)
    path.chmod(0o600)


def render_compose(root, settings):
    q = lambda value: json.dumps(str(value), ensure_ascii=False)
    state = state_dir(root)
    env_file = f'    env_file:\n      - path: {q((state / "app.env").as_posix())}\n        format: raw\n'
    volume = f'    volumes:\n      - {q((state / "data").as_posix() + ":/app/data")}\n'
    result = 'services:\n  migrator:\n    image: ' + q(settings['migrator_image']) + '\n' + env_file + volume
    result += '    command: ["sh", "-c", "npx prisma migrate deploy && node prisma/init-platform-admin.mjs && mkdir -p /app/data/maintenance && chown -R 1001:1001 /app/data"]\n    restart: "no"\n'
    result += '  app:\n    image: ' + q(settings['app_image']) + '\n' + env_file + volume
    result += '    restart: unless-stopped\n    security_opt: ["no-new-privileges:true"]\n    cap_drop: ["ALL"]\n'
    result += '    healthcheck:\n      test: ["CMD", "node", "-e", "fetch(\'http://127.0.0.1:3000/api/health\').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]\n      interval: 10s\n      timeout: 5s\n      retries: 12\n'
    if settings['mode'] in ('local', 'proxy'):
        result += f'    ports: ["127.0.0.1:{settings["port"]}:3000"]\n'
    else:
        result += '  gateway:\n    image: caddy:2-alpine\n    restart: unless-stopped\n    ports: ["80:80", "443:443"]\n    volumes:\n'
        for source, target in [('Caddyfile', '/etc/caddy/Caddyfile:ro'), ('caddy-data', '/data'), ('caddy-config', '/config')]:
            result += '      - ' + q((state / source).as_posix() + ':' + target) + '\n'
    return result


def render_gateway(settings):
    hostname = urlparse(settings['url']).hostname
    internal = '    tls internal\n' if settings['mode'] == 'lan' else ''
    return f'{hostname} {{\n{internal}    request_body {{\n        max_size 60MB\n    }}\n    reverse_proxy app:3000\n}}\n'


def initialize(root, args):
    state = state_dir(root)
    if state.exists():
        raise RuntimeError('.selfhost 已存在；拒绝覆盖配置、密钥或数据。请用 up/doctor，或为新实例使用另一份源码目录。')
    mode = args.mode or input('部署模式 local / lan / public / proxy [local]: ').strip() or 'local'
    if mode not in ('local', 'lan', 'public', 'proxy'):
        raise ValueError('未知部署模式。')
    url = args.url or (f'http://localhost:{args.port}' if mode == 'local' else input('完整 HTTPS 访问地址: ').strip())
    url = validate_url(mode, url, args.port)
    email = args.admin_email or input('平台管理员邮箱: ').strip()
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email):
        raise ValueError('管理员邮箱格式不正确。')
    if args.app_image and not args.migrator_image or args.migrator_image and not args.app_image:
        raise ValueError('使用成品镜像时，必须同时提供 app 和 migrator 的同版本镜像。')
    project = 'labcop-' + hashlib.sha256(str(root).encode()).hexdigest()[:10]
    settings = dict(schema=1, mode=mode, url=url, port=args.port, project=project,
                    app_image=args.app_image or project + '-app:local',
                    migrator_image=args.migrator_image or project + '-migrator:local',
                    source_build=not bool(args.app_image), release=args.release or 'selfhost-source')
    for image in (settings['app_image'], settings['migrator_image']):
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._/:@-]*', image):
            raise ValueError('镜像名称包含不支持的字符。')
    password = getpass.getpass('管理员密码（至少16位，留空自动生成并保存到配置文件）: ') if not args.non_interactive else ''
    password = password or secrets.token_urlsafe(24)
    if len(password) < 16:
        raise ValueError('管理员密码至少16位。')
    env = dict(DATABASE_URL='file:/app/data/lab.db', NODE_ENV='production',
               JWT_SECRET=secrets.token_urlsafe(48), CAPTCHA_SECRET=secrets.token_urlsafe(48),
               CREDENTIAL_ENCRYPTION_KEY=base64.b64encode(secrets.token_bytes(32)).decode(),
               APP_BASE_URL=url, DOMAIN=urlparse(url).hostname,
               AUTH_COOKIE_SECURE='false' if mode == 'local' else 'true',
               MAINTENANCE_STATIC_DIR='/app/data/maintenance',
               PLATFORM_ADMIN_EMAIL=email.lower(), PLATFORM_ADMIN_PASSWORD=password,
               PLATFORM_ADMIN_NAME='平台管理员', OPENAI_API_KEY='', OPENAI_BASE_URL='', OPENAI_MODEL='',
               SMTP_HOST='', SMTP_PORT='465', SMTP_USER='', SMTP_PASS='', SMTP_FROM='')
    if not args.non_interactive:
        env['SMTP_HOST'] = input('SMTP 服务器（本机试用可留空；其他模式需配置）: ').strip()
        if env['SMTP_HOST']:
            env['SMTP_PORT'] = input('SMTP 端口 [465]: ').strip() or '465'
            env['SMTP_USER'] = input('SMTP 用户/发件邮箱: ').strip()
            env['SMTP_PASS'] = getpass.getpass('SMTP 授权密码: ')
    if any('\n' in value or '\r' in value or '\x00' in value for value in env.values()):
        raise ValueError('配置值不能包含换行或空字符。')
    state.mkdir(mode=0o700)
    (state / 'data').mkdir(mode=0o700)
    write_private(state / 'settings.json', json.dumps(settings, ensure_ascii=False, indent=2) + '\n')
    write_private(state / 'app.env', ''.join(f'{key}={value}\n' for key, value in env.items()))
    write_private(state / 'compose.yaml', render_compose(root, settings))
    if mode in ('lan', 'public'):
        write_private(state / 'Caddyfile', render_gateway(settings))
    print('配置已生成：.selfhost/app.env（包含管理员密码，请在本机查看，勿上传或粘贴到日志）')
    if not env['SMTP_HOST']:
        print('尚未配置 SMTP：普通用户注册/找回密码不能通过真实邮件完成；公开或多人使用前必须配置。')
    print('下一步：setup up；已有配置时重复执行 init 会拒绝覆盖。')


def read_env(root):
    return dict(line.split('=', 1) for line in (state_dir(root) / 'app.env').read_text(encoding='utf-8').splitlines()
                if line and not line.startswith('#') and '=' in line)


def validate_config(root):
    settings, env = load(root), read_env(root)
    validate_url(settings['mode'], settings['url'], settings['port'])
    for key in ('JWT_SECRET', 'CAPTCHA_SECRET', 'CREDENTIAL_ENCRYPTION_KEY', 'PLATFORM_ADMIN_EMAIL', 'PLATFORM_ADMIN_PASSWORD'):
        if not env.get(key):
            raise ValueError('缺少配置：' + key)
    if len(env['PLATFORM_ADMIN_PASSWORD']) < 16 or len(base64.b64decode(env['CREDENTIAL_ENCRYPTION_KEY'], validate=True)) != 32:
        raise ValueError('管理员密码或加密密钥格式不正确。')
    if env.get('APP_BASE_URL') != settings['url'] or env.get('DATABASE_URL') != 'file:/app/data/lab.db':
        raise ValueError('APP_BASE_URL 或 DATABASE_URL 与快捷部署配置不一致。')
    if settings['mode'] != 'local':
        if env.get('AUTH_COOKIE_SECURE') != 'true' or not env.get('SMTP_HOST'):
            raise ValueError('多人/公网模式必须开启安全 Cookie 并配置 SMTP_HOST。')
    if env.get('SMTP_HOST') and (not env.get('SMTP_PORT', '').isdigit() or not 1 <= int(env['SMTP_PORT']) <= 65535):
        raise ValueError('SMTP_PORT 应为有效端口。')
    return settings


@contextmanager
def operation_lock(root):
    lock = state_dir(root) / 'operation.lock'
    try:
        write_private(lock, str(os.getpid()))
    except FileExistsError:
        raise RuntimeError('另一项部署/备份/恢复操作正在执行。若上次异常退出，先确认进程已结束，再移除 operation.lock。') from None
    try:
        yield
    finally:
        lock.unlink()


def database_check(path):
    if not path.is_file():
        raise RuntimeError('找不到数据库；请先完成首次启动。')
    with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)) as db:
        if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)] or db.execute('PRAGMA foreign_key_check').fetchall():
            raise RuntimeError('数据库完整性检查失败。')


def backup(root, restart=True):
    state = state_dir(root)
    running = compose(root, 'ps', '--status', 'running', '--services', capture=True).stdout.split()
    if 'migrator' in running:
        raise RuntimeError('迁移正在运行，暂不能备份。')
    stopped = [service for service in ('app', 'gateway') if service in running]
    if stopped:
        compose(root, 'stop', *stopped)
    try:
        database_check(state / 'data/lab.db')
        directory = state / 'backups'
        directory.mkdir(mode=0o700, exist_ok=True)
        archive = directory / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S') + '-' + secrets.token_hex(3) + '.tar.gz')
        try:
            with archive.open('xb') as output:
                with tarfile.open(fileobj=output, mode='w:gz') as tar:
                    for entry in sorted(state.iterdir()):
                        if entry.name not in ('backups', 'operation.lock'):
                            tar.add(entry, arcname='.selfhost/' + entry.name)
            archive.chmod(0o600)
        except Exception:
            archive.unlink(missing_ok=True)
            raise
        digest = hash_file(archive)
        write_private(archive.with_suffix(archive.suffix + '.sha256'), digest + '\n')
        print('一致性备份已保存：' + str(archive))
        print('此备份含明文密钥和数据，请保存到受控/加密存储，并制作异机副本。')
        return archive
    finally:
        if restart and stopped:
            compose(root, 'start', *stopped)


def wait_ready(root, settings):
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        container = compose(root, 'ps', '-q', 'app', capture=True).stdout.strip()
        if container:
            status = run(['docker', 'inspect', '--format', '{{.State.Health.Status}}', container], root, capture=True).stdout.strip()
            if status == 'healthy':
                break
        time.sleep(3)
    else:
        raise RuntimeError('应用健康检查超时。请运行 logs 和 doctor；未宣称启动成功。')
    context = None
    if settings['mode'] == 'lan':
        ca = state_dir(root) / 'caddy-data/caddy/pki/authorities/local/root.crt'
        if not ca.is_file():
            raise RuntimeError('校内 HTTPS 证书尚未就绪，请查看 gateway 日志。')
        context = ssl.create_default_context(cafile=str(ca))
    target = settings['url'] + '/api/health'
    for attempt in range(12):
        try:
            with urllib.request.urlopen(target, timeout=5, context=context) as response:
                if json.load(response).get('status') == 'ok':
                    print('应用及访问入口健康检查通过：' + settings['url'])
                    print('平台管理员入口：' + settings['url'] + '/developer-login')
                    return
        except (OSError, ValueError):
            time.sleep(2)
    raise RuntimeError('应用已健康，但访问地址/HTTPS 未通过验证。检查 DNS、防火墙、代理或校内 CA；不要忽略证书错误。')


def start(root, rebuild=False):
    settings = validate_config(root)
    check_docker(root)
    compose(root, 'config', '--quiet')
    if settings['source_build']:
        images_exist = all(subprocess.run(['docker', 'image', 'inspect', image], cwd=root,
                                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
                           for image in (settings['app_image'], settings['migrator_image']))
        if rebuild or not images_exist:
            for target, image in [('builder', settings['migrator_image']), ('runner', settings['app_image'])]:
                run(['docker', 'build', '--target', target, '--build-arg', 'APP_RELEASE=' + settings['release'], '-t', image, '.'], root)
    else:
        compose(root, 'pull', 'app', 'migrator')
    if (state_dir(root) / 'data/lab.db').exists():
        backup(root, restart=False)
    # Freeze existing writes before migrating; a failure leaves the app stopped.
    compose(root, 'stop', 'app')
    compose(root, 'up', '--force-recreate', '--exit-code-from', 'migrator', 'migrator')
    compose(root, 'up', '-d', '--force-recreate', '--no-deps', 'app')
    if settings['mode'] in ('lan', 'public'):
        compose(root, 'up', '-d', '--no-deps', 'gateway')
    wait_ready(root, settings)


def restore(root, archive):
    destination = state_dir(root)
    if destination.exists():
        raise RuntimeError('恢复只允许到没有 .selfhost 的全新源码目录；拒绝覆盖现有数据。')
    checksum = archive.with_suffix(archive.suffix + '.sha256')
    if not checksum.is_file() or hash_file(archive) != checksum.read_text().strip():
        raise RuntimeError('备份 SHA-256 校验失败或缺少校验文件。')
    stage = Path(tempfile.mkdtemp(prefix='.selfhost-restore-', dir=root))
    try:
        with tarfile.open(archive, 'r:gz') as tar:
            for item in tar.getmembers():
                name = PurePosixPath(item.name)
                if name.is_absolute() or '..' in name.parts or not name.parts or name.parts[0] != '.selfhost' or '\\' in item.name or ':' in item.name or not (item.isdir() or item.isfile()):
                    raise RuntimeError('备份包含不安全路径或链接，拒绝恢复。')
                target = stage.joinpath(*name.parts)
                if item.isdir():
                    target.mkdir(parents=True, exist_ok=True, mode=0o700)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                    with tar.extractfile(item) as source, target.open('xb') as output:
                        shutil.copyfileobj(source, output)
                    target.chmod(0o600)
        staged_root = stage
        settings = validate_config(staged_root)
        database_check(stage / '.selfhost/data/lab.db')
        settings['project'] = 'labcop-' + hashlib.sha256(str(root).encode()).hexdigest()[:10]
        restored = stage / '.selfhost'
        (restored / 'settings.json').write_text(json.dumps(settings, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        (restored / 'compose.yaml').write_text(render_compose(root, settings), encoding='utf-8')
        restored.rename(destination)
        print('恢复完成；密钥已保留。确认源码/镜像版本、域名和 SMTP 配置后再运行 up。')
    finally:
        if stage.resolve().parent != root.resolve() or not stage.name.startswith('.selfhost-restore-'):
            raise RuntimeError('临时恢复目录路径核验失败。')
        shutil.rmtree(stage)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT, help='源码目录；默认由脚本位置决定')
    sub = parser.add_subparsers(dest='command', required=True)
    init = sub.add_parser('init', help='交互配置，绝不覆盖已有实例')
    init.add_argument('--mode', choices=['local', 'lan', 'public', 'proxy'])
    init.add_argument('--url')
    init.add_argument('--port', type=int, default=3000)
    init.add_argument('--admin-email')
    init.add_argument('--non-interactive', action='store_true', help='自动生成密码；SMTP 需之后编辑 app.env')
    init.add_argument('--app-image')
    init.add_argument('--migrator-image')
    init.add_argument('--release')
    up = sub.add_parser('up', help='构建/拉取、备份、迁移、启动并检查入口')
    up.add_argument('--build', action='store_true', help='强制重建源码镜像；升级时使用')
    for command in ('down', 'status', 'logs', 'doctor', 'backup'):
        sub.add_parser(command)
    recovery = sub.add_parser('restore', help='恢复到全新实例目录')
    recovery.add_argument('archive', type=Path)
    args = parser.parse_args(argv)
    # Migrator assigns the data volume to container UID 1001; Caddy protects its
    # private-key directories. Host integrity checks/backups must read both.
    if sys.platform.startswith('linux') and os.geteuid() != 0:
        raise RuntimeError('Linux快捷部署需要管理员权限读取容器数据和证书。请由管理员使用 sudo sh deploy/setup.sh 执行；不要放宽数据或私钥权限。')
    root = args.root.resolve()
    if not (root / 'package.json').is_file() or not (root / 'Dockerfile').is_file():
        raise ValueError('源码目录必须包含 package.json 和 Dockerfile。')
    if args.command == 'init':
        initialize(root, args)
    elif args.command == 'restore':
        restore(root, args.archive.resolve())
    elif args.command in ('up', 'down', 'backup'):
        with operation_lock(root):
            if args.command == 'up':
                start(root, args.build)
            else:
                check_docker(root)
                if args.command == 'backup':
                    backup(root)
                else:
                    compose(root, 'stop')
                    print('已停止，配置、数据和备份保留。')
    else:
        validate_config(root)
        check_docker(root)
        if args.command == 'doctor':
            compose(root, 'config', '--quiet')
            compose(root, 'ps', '-a')
            print('配置检查通过；状态请查看上表。完整启动验收由 up 检查应用和访问入口。')
        elif args.command == 'status':
            compose(root, 'ps', '-a')
        else:
            compose(root, 'logs', '--tail', '100')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print('操作未完成：' + str(error), file=sys.stderr)
        sys.exit(1)
