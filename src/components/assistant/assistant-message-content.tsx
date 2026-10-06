'use client';

import { StructureCard } from './structure-card';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { isSafeAssistantImageSource, normalizeAssistantMarkup, structureSmiles } from '@/lib/assistant-markup';

function withoutNode<T extends { node?: unknown }>(props: T): Omit<T, 'node'> {
  const { node, ...elementProps } = props;
  void node;
  return elementProps;
}

const components: Components = {
  h1: (props) => <h1 {...withoutNode(props)} className="mb-2 mt-4 text-lg font-semibold first:mt-0" />,
  h2: (props) => <h2 {...withoutNode(props)} className="mb-2 mt-4 text-base font-semibold first:mt-0" />,
  h3: (props) => <h3 {...withoutNode(props)} className="mb-1.5 mt-3 text-sm font-semibold first:mt-0" />,
  p: (props) => <p {...withoutNode(props)} className="my-2 whitespace-pre-wrap first:mt-0 last:mb-0" />,
  ul: (props) => <ul {...withoutNode(props)} className="my-2 list-disc space-y-1 pl-5" />,
  ol: (props) => <ol {...withoutNode(props)} className="my-2 list-decimal space-y-1 pl-5" />,
  li: (props) => <li {...withoutNode(props)} className="pl-0.5" />,
  blockquote: (props) => (
    <blockquote {...withoutNode(props)} className="my-2 border-l-2 border-gray-300 pl-3 text-gray-600" />
  ),
  hr: (props) => <hr {...withoutNode(props)} className="my-3 border-gray-200" />,
  strong: (props) => <strong {...withoutNode(props)} className="font-semibold text-gray-950" />,
  a: (componentProps) => {
    const { href, ...props } = withoutNode(componentProps);
    const external = Boolean(href && !href.startsWith('/') && !href.startsWith('#'));
    return (
      <a
        {...props}
        className="text-teal-700 underline decoration-teal-300 underline-offset-2 hover:text-teal-900"
        href={href}
        rel={external ? 'noopener noreferrer' : undefined}
        target={external ? '_blank' : undefined}
      />
    );
  },
  table: (props) => (
    <div className="my-3 max-w-full overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table {...withoutNode(props)} className="w-full min-w-max border-collapse text-left text-xs" />
    </div>
  ),
  thead: (props) => <thead {...withoutNode(props)} className="bg-gray-50 text-gray-700" />,
  tbody: (props) => <tbody {...withoutNode(props)} className="divide-y divide-gray-100" />,
  tr: (props) => <tr {...withoutNode(props)} className="divide-x divide-gray-100" />,
  th: (props) => <th {...withoutNode(props)} className="px-3 py-2 font-semibold whitespace-nowrap" />,
  td: (props) => <td {...withoutNode(props)} className="px-3 py-2 align-top whitespace-normal" />,
  pre: (props) => <div className="my-2 max-w-full overflow-x-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs leading-relaxed">{props.children}</div>,
  code: (componentProps) => {
    const { className, ...props } = withoutNode(componentProps);
    if (className === 'language-smiles') return <StructureCard smiles={String(props.children).trim()} />;
    return (
      <code
        {...props}
        className={className || 'rounded bg-gray-200/70 px-1 py-0.5 font-mono text-[0.9em] text-gray-900'}
      />
    );
  },
  img: (componentProps) => {
    const { src, alt, ...props } = withoutNode(componentProps);
    const imageSource = typeof src === 'string' ? src : undefined;
    if (!isSafeAssistantImageSource(imageSource)) {
      return <span className="text-xs text-gray-400">[图片地址不可用]</span>;
    }

    const smiles = structureSmiles(imageSource);
    if (smiles !== null) return <StructureCard smiles={smiles} name={alt || '分子结构'} />;
    return (
      // 动态助手内容无法预先配置尺寸和远程域名，因此使用原生图片元素。
      // eslint-disable-next-line @next/next/no-img-element
      <img
        {...props}
        src={imageSource}
        alt={alt || '助手返回的图片'}
        className="my-3 max-h-[420px] max-w-full rounded-lg border border-gray-200 bg-white object-contain"
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
      />
    );
  },
};

interface AssistantMessageContentProps {
  content: string;
  compact?: boolean;
}

export function AssistantMessageContent({ content, compact = false }: AssistantMessageContentProps) {
  return (
    <div className={compact ? 'min-w-0 break-words text-[13px] leading-relaxed' : 'min-w-0 break-words text-sm leading-relaxed'}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
        components={components}
      >
        {normalizeAssistantMarkup(content)}
      </ReactMarkdown>
    </div>
  );
}
