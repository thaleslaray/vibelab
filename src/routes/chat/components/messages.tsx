import { AIAvatar } from '../../../components/icons/logos';
import clsx from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeExternalLinks from 'rehype-external-links';
import { LoaderCircle, Check, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import type { ToolEvent } from '../utils/message-helpers';
import { useState } from 'react';

/**
 * Strip internal system tags that should not be displayed to users
 */
function sanitizeMessageForDisplay(message: string): string {
	// Remove <system_context>...</system_context> tags and their content
	return message.replace(/<system_context>[\s\S]*?<\/system_context>\n/gi, '').trim();
}

export function UserMessage({ message }: { message: string }) {
	const sanitizedMessage = sanitizeMessageForDisplay(message);
	
	return (
		<div className="flex gap-3">
			<div className="align-text-top pl-1">
				<div className="size-6 flex items-center justify-center rounded-full bg-accent text-text-on-brand">
					<span className="text-xs">U</span>
				</div>
			</div>
			<div className="flex flex-col gap-2 min-w-0">
				<div className="font-medium text-text-50">You</div>
				<Markdown className="text-text-primary/80">{sanitizedMessage}</Markdown>
			</div>
		</div>
	);
}

type ContentItem = 
	| { type: 'text'; content: string; key: string }
	| { type: 'tool'; event: ToolEvent; key: string };

function JsonRenderer({ data }: { data: unknown }) {
	if (typeof data !== 'object' || data === null) {
		return <span className="text-text-primary whitespace-pre-wrap">{String(data)}</span>;
	}

	return (
		<div className="flex flex-col gap-1">
			{Object.entries(data).map(([key, value]) => (
				<div key={key} className="flex gap-2">
					<span className="text-accent font-medium flex-shrink-0">{key}:</span>
					{typeof value === 'object' && value !== null ? (
						<div className="flex-1">
							<JsonRenderer data={value} />
						</div>
					) : (
						<span className="text-text-primary flex-1 whitespace-pre-wrap break-words">
							{String(value)}
						</span>
					)}
				</div>
			))}
		</div>
	);
}

function ToolResultRenderer({ result }: { result: string }) {
	try {
		const parsed = JSON.parse(result);
		return <JsonRenderer data={parsed} />;
	} catch {
		return <div className="whitespace-pre-wrap break-words">{result}</div>;
	}
}

function ToolStatusIndicator({ event }: { event: ToolEvent }) {
	const [isExpanded, setIsExpanded] = useState(false);
	const hasResult = event.status === 'success' && event.result;
	
	const statusText = event.status === 'start' ? 'Running' : 
	                   event.status === 'success' ? 'Completed' : 
	                   'Error';
	
	const StatusIcon = event.status === 'start' ? LoaderCircle : 
	                   event.status === 'success' ? Check : 
	                   AlertTriangle;
	
	const iconClass = event.status === 'start' ? 'size-3 animate-spin' : 'size-3';
	
	return (
		<div className="flex flex-col gap-2">
			<button
				onClick={() => hasResult && setIsExpanded(!isExpanded)}
				className={clsx(
					'flex items-center gap-1.5 text-xs text-text-tertiary',
					hasResult && 'cursor-pointer hover:text-text-secondary transition-colors'
				)}
				disabled={!hasResult}
			>
				<StatusIcon className={iconClass} />
				<span className="font-mono tracking-tight">
					{statusText} {event.name}
				</span>
				{hasResult && (
					isExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />
				)}
			</button>
			
			{isExpanded && hasResult && event.result && (
				<div className="p-3 rounded-md bg-surface-secondary text-xs font-mono border border-border overflow-auto max-h-96">
					<ToolResultRenderer result={event.result} />
				</div>
			)}
		</div>
	);
}

function buildOrderedContent(message: string, inlineToolEvents: ToolEvent[]): ContentItem[] {
	if (!inlineToolEvents.length) {
		return message ? [{ type: 'text', content: message, key: 'content-0' }] : [];
	}

	const items: ContentItem[] = [];
	let lastPos = 0;
	
	for (const event of inlineToolEvents) {
		const pos = event.contentLength ?? 0;
		
		// Add text before this event
		if (pos > lastPos && message.slice(lastPos, pos)) {
			items.push({ type: 'text', content: message.slice(lastPos, pos), key: `text-${lastPos}` });
		}
		
		// Add event
		items.push({ type: 'tool', event, key: `tool-${event.timestamp}` });
		lastPos = pos;
	}
	
	// Add remaining text
	if (lastPos < message.length && message.slice(lastPos)) {
		items.push({ type: 'text', content: message.slice(lastPos), key: `text-${lastPos}` });
	}
	
	return items;
}

export function AIMessage({
	message,
	isThinking,
	toolEvents = [],
}: {
	message: string;
	isThinking?: boolean;
	toolEvents?: ToolEvent[];
}) {
	const sanitizedMessage = sanitizeMessageForDisplay(message);
	
	// Separate: events without contentLength = top (restored), with contentLength = inline (streaming)
	const topToolEvents = toolEvents.filter(ev => ev.contentLength === undefined);
	const inlineToolEvents = toolEvents.filter(ev => ev.contentLength !== undefined)
		.sort((a, b) => (a.contentLength ?? 0) - (b.contentLength ?? 0));
	
	const orderedContent = buildOrderedContent(sanitizedMessage, inlineToolEvents);
	
	// Don't render if completely empty
	if (!sanitizedMessage && !topToolEvents.length && !orderedContent.length) {
		return null;
	}
	
	return (
		<div className="flex gap-3">
			<div className="align-text-top pl-1">
				<AIAvatar className="size-6 text-orange-500" />
			</div>
			<div className="flex flex-col gap-2 min-w-0">
				<div className="font-mono font-medium text-text-50">Orange</div>
				
				{/* Message content with inline tool events (from streaming) */}
				{orderedContent.length > 0 && (
					<div className="flex flex-col gap-2">
						{orderedContent.map((item) => (
							item.type === 'text' ? (
								<Markdown key={item.key} className={clsx('a-tag', isThinking && 'animate-pulse')}>
									{item.content}
								</Markdown>
							) : (
								<div key={item.key} className="my-1">
									<ToolStatusIndicator event={item.event} />
								</div>
							)
						))}
					</div>
				)}
				
				{/* Completed tools (from restoration) - shown at end */}
				{topToolEvents.length > 0 && (
					<div className="flex flex-col gap-1.5 mt-1">
						{topToolEvents.map((ev) => (
							<ToolStatusIndicator key={`${ev.name}-${ev.timestamp}`} event={ev} />
						))}
					</div>
				)}
			</div>
		</div>
	);
}

interface MarkdownProps extends React.ComponentProps<'article'> {
	children: string;
}

export function Markdown({ children, className, ...props }: MarkdownProps) {
	return (
		<article
			className={clsx('prose prose-sm prose-teal', className)}
			{...props}
		>
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				rehypePlugins={[[rehypeExternalLinks, { target: '_blank' }]]}
			>
				{children}
			</ReactMarkdown>
		</article>
	);
}
