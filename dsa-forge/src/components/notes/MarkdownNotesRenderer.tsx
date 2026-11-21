"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { tokenizeCode, getTokenClass } from "@/components/ai/PrimeAiMessageRenderer";
import { ChevronDown, ChevronRight, Copy, Check } from "lucide-react";

interface MarkdownNotesRendererProps {
  content: string;
  className?: string;
  isCompact?: boolean;
}

function CollapsibleCodeBlock({
  code,
  lang,
  isCompact = false,
}: {
  code: string;
  lang?: string;
  isCompact?: boolean;
}) {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [copied, setCopied] = useState(false);

  const lines = code.split("\n");
  const lineCount = lines.length;
  const tokens = tokenizeCode(code, lang || "cpp");

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "my-2.5 rounded-xl border border-white/10 bg-[#080914] overflow-hidden shadow-lg transition-all",
        isCompact && "my-1 sm:my-1.5 rounded-lg border-white/[0.08] bg-white/[0.02] shadow-none"
      )}
    >
      {/* Header with collapse toggle, language badge, line count, and copy button */}
      <div
        onClick={(e) => {
          e.stopPropagation();
          setIsCollapsed(!isCollapsed);
        }}
        className={cn(
          "flex items-center justify-between px-3 py-1.5 bg-white/[0.04] cursor-pointer hover:bg-white/[0.07] transition-colors select-none",
          !isCollapsed ? "border-b border-white/[0.08]" : "",
          isCompact && "px-2 sm:px-2.5 py-1 sm:py-1.5 bg-white/[0.025] hover:bg-white/[0.05]"
        )}
      >
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
          <span className="text-zinc-400 hover:text-white transition-colors shrink-0">
            {isCollapsed ? (
              <ChevronRight className={cn("text-violet-400", isCompact ? "w-3 h-3" : "w-3.5 h-3.5")} />
            ) : (
              <ChevronDown className={cn("text-violet-400", isCompact ? "w-3 h-3" : "w-3.5 h-3.5")} />
            )}
          </span>
          <span
            className={cn(
              "font-mono font-bold uppercase tracking-wider rounded shrink-0",
              isCompact
                ? "text-[9.5px] px-1.5 py-0.5 bg-violet-500/15 text-violet-300 border border-violet-500/25"
                : "text-[10px] px-1.5 py-0.5 bg-violet-500/20 text-violet-300 border border-violet-500/30"
            )}
          >
            Code
          </span>
          <span
            className={cn(
              "text-zinc-400 font-mono shrink-0",
              isCompact ? "text-[10.5px] sm:text-[11px]" : "text-[11px]"
            )}
          >
            {lineCount} {lineCount === 1 ? "line" : "lines"}
          </span>
          <span
            className={cn(
              "text-zinc-500 italic truncate text-[10px]",
              isCompact && "hidden sm:inline"
            )}
          >
            {isCollapsed ? "· Click to expand" : "· Click to collapse"}
          </span>
        </div>

        <button
          onClick={handleCopy}
          type="button"
          className={cn(
            "flex items-center gap-1 rounded font-medium text-zinc-400 hover:text-white hover:bg-white/10 transition-colors shrink-0",
            isCompact ? "px-1.5 sm:px-2 py-0.5 text-[10px]" : "px-2 py-0.5 text-[10px]"
          )}
          title="Copy code"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-400 shrink-0" />
              <span className={cn("text-emerald-400", isCompact && "hidden sm:inline")}>Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3 shrink-0" />
              <span className={cn(isCompact && "hidden sm:inline")}>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code body (collapsible with Prime AI colorful syntax highlighting) */}
      {!isCollapsed && (
        <pre
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "p-3.5 max-h-72 overflow-y-auto overflow-x-auto font-mono text-xs leading-relaxed select-text [scrollbar-width:thin] border-t border-white/[0.08] bg-[#070811]",
            isCompact && "p-2.5 max-h-48 sm:max-h-56 text-[11px] border-t border-white/[0.06]"
          )}
        >
          <code>
            {tokens.map((token, i) => (
              <span key={i} className={getTokenClass(token.type, token.value)}>
                {token.value}
              </span>
            ))}
          </code>
        </pre>
      )}
    </div>
  );
}

/**
 * Normalizes note content so that raw HTML entities, stray wrapper tags,
 * and mixed Markdown/HTML render cleanly without raw tags spilling into view.
 */
function normalizeNotesContent(content: string): string {
  if (!content) return "";
  let text = content;

  // 1. Unescape HTML entities that may have been saved as entities or escaped
  text = text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&ast;/gi, "*")
    .replace(/&#42;/g, "*")
    .replace(/&nbsp;/g, " ")
    .replace(/\\([*_`~])/g, "$1") // unescape escaped markdown symbols like \* or \_
    .replace(/\\<([a-z0-9]+)>/gi, "<$1>")
    .replace(/\\<\//gi, "</");

  // 2. Normalize mixed markdown/HTML italic and underline combinations
  text = text
    .replace(/\*\s*<u\b[^>]*>([\s\S]*?)<\/u>\s*\*/gi, "<u><i>$1</i></u>")
    .replace(/<u\b[^>]*>\s*\*([\s\S]*?)\*\s*<\/u>/gi, "<u><i>$1</i></u>")
    .replace(/\b_\s*<u\b[^>]*>([\s\S]*?)<\/u>\s*_\b/gi, "<u><i>$1</i></u>")
    .replace(/<u\b[^>]*>\s*_([\s\S]*?)_\s*<\/u>/gi, "<u><i>$1</i></u>");

  // 3. Strip non-formatting HTML wrapper tags while normalizing paragraphs and breaks
  text = text
    .replace(/<\/?(?:span|font|div)\b[^>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?p\b[^>]*>/gi, "\n");

  return text;
}

/**
 * Tokenizes inline Markdown and HTML formatting:
 * - Bold: **text**, <b>text</b>, <strong>text</strong>
 * - Italic: *text*, _text_, <i>text</i>, <em>text</em>
 * - Underline: <u>text</u>, __text__
 * - Inline code / Prime AI highlight: `code`, <mark>code</mark>, <code>code</code>
 * - Big-O notation: O(1), O(n), O(n log n), etc.
 */
function renderInlineTokens(text: string, depth = 0): React.ReactNode {
  if (!text) return null;
  if (depth > 5) return text;

  // Regex matches:
  // 1. `inline code`
  // 2. <mark>highlight</mark> or <code class="...">highlight</code>
  // 3. <u>underline</u> (case-insensitive)
  // 4. __underline__
  // 5. **bold** or <b>bold</b> or <strong>bold</strong>
  // 6. *italic* or _italic_ or <i>italic</i> or <em>italic</em>
  // 7. O(...) complexity (non-backtracking)
  const tokenRegex =
    /(`[^`]+`|<mark\b[^>]*>[\s\S]*?<\/mark>|<code\b[^>]*>[\s\S]*?<\/code>|<u\b[^>]*>[\s\S]*?<\/u>|__[^_]+__|\*\*[^*]+\*\*|<(?:b|strong)\b[^>]*>[\s\S]*?<\/(?:b|strong)>|\*[^*\r\n]+?\*|(?<!\w)_[^_\r\n]+?_(?!\w)|<(?:i|em)\b[^>]*>[\s\S]*?<\/(?:i|em)>|\bO\([^()\n\r]+(?:\([^()\n\r]+\)[^()\n\r]*)?\))/gi;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }

    const val = match[0];
    const key = `${match.index}-${val.slice(0, 8)}`;
    const lower = val.toLowerCase();

    // 1. Inline Code / Highlight
    if (
      (val.startsWith("`") && val.endsWith("`")) ||
      (lower.startsWith("<mark") && lower.endsWith("</mark>")) ||
      (lower.startsWith("<code") && lower.endsWith("</code>"))
    ) {
      let code = "";
      if (val.startsWith("`")) {
        code = val.slice(1, -1);
      } else {
        code = val.replace(/^<[^>]+>/, "").replace(/<\/[^>]+>$/, "");
      }
      parts.push(
        <code
          key={key}
          className="bg-amber-400/25 border border-amber-400/50 text-amber-200 shadow-[0_0_10px_rgba(245,158,11,0.2)] font-mono text-[11px] sm:text-[12px] font-semibold px-1.5 py-0.5 rounded-md mx-0.5 break-words [word-break:break-word] inline-block align-baseline max-w-full"
        >
          {code}
        </code>
      );
    }
    // 2. Underline
    else if (
      (lower.startsWith("<u") && lower.endsWith("</u>")) ||
      (val.startsWith("__") && val.endsWith("__"))
    ) {
      const inner = lower.startsWith("<u")
        ? val.replace(/^<u\b[^>]*>/i, "").replace(/<\/u>$/i, "")
        : val.slice(2, -2);
      parts.push(
        <span
          key={key}
          className="underline underline-offset-2 decoration-amber-400/80 text-slate-100 font-medium decoration-1.5"
        >
          {renderInlineTokens(inner, depth + 1)}
        </span>
      );
    }
    // 3. Bold
    else if (
      (val.startsWith("**") && val.endsWith("**")) ||
      (lower.startsWith("<b") && lower.endsWith("</b>")) ||
      (lower.startsWith("<strong") && lower.endsWith("</strong>"))
    ) {
      const inner = val.startsWith("**")
        ? val.slice(2, -2)
        : val.replace(/^<(?:b|strong)\b[^>]*>/i, "").replace(/<\/(?:b|strong)>$/i, "");
      parts.push(
        <strong key={key} className="text-white font-bold tracking-tight">
          {renderInlineTokens(inner, depth + 1)}
        </strong>
      );
    }
    // 4. Italic
    else if (
      (val.startsWith("*") && val.endsWith("*") && val.length > 2) ||
      (val.startsWith("_") && val.endsWith("_") && val.length > 2) ||
      (lower.startsWith("<i") && lower.endsWith("</i>")) ||
      (lower.startsWith("<em") && lower.endsWith("</em>"))
    ) {
      const inner =
        val.startsWith("*") || val.startsWith("_")
          ? val.slice(1, -1)
          : val.replace(/^<(?:i|em)\b[^>]*>/i, "").replace(/<\/(?:i|em)>$/i, "");
      parts.push(
        <em key={key} className="text-amber-100/90 italic">
          {renderInlineTokens(inner.trim(), depth + 1)}
        </em>
      );
    }
    // 5. Big-O Complexity
    else if (/^\bO\(.+\)$/i.test(val)) {
      parts.push(
        <span
          key={key}
          className="inline-flex items-center gap-1 font-mono text-[11px] font-bold px-1.5 py-0.5 mx-0.5 rounded-md border align-baseline bg-amber-400/25 border-amber-400/50 text-amber-200 shadow-[0_0_10px_rgba(245,158,11,0.2)]"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
          <span>{val}</span>
        </span>
      );
    }

    lastIndex = match.index + val.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts;
}

interface Block {
  type: "h1" | "h2" | "h3" | "ul" | "ol" | "code" | "quote" | "p";
  items?: string[];
  text?: string;
  lang?: string;
}

function parseBlocks(markdown: string): Block[] {
  if (!markdown) return [];
  const lines = markdown.split(/\r?\n/);
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const startI = i;
    const line = lines[i];

    // 1. Fenced Code Block
    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // consume closing fence
      blocks.push({ type: "code", lang, text: codeLines.join("\n") });
      continue;
    }

    // 2. Headings (#, ##, ###) - safely consume empty or populated headings
    const headingMatch = line.trim().match(/^(#{1,3})(?:\s+(.*))?$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = (headingMatch[2] || "").trim();
      if (text) {
        blocks.push({
          type: level === 1 ? "h1" : level === 2 ? "h2" : "h3",
          text,
        });
      }
      i++;
      continue;
    }

    // 3. Blockquote (> ...)
    if (line.trim().startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ type: "quote", text: quoteLines.join("\n") });
      continue;
    }

    // 4. Bullet list (- or * or •)
    const isAsteriskLine = /^\s*\*+[^*]+\*+\s*$/.test(line);
    if (!isAsteriskLine && /^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (
        i < lines.length &&
        !/^\s*\*+[^*]+\*+\s*$/.test(lines[i]) &&
        /^\s*[-*•]\s+/.test(lines[i])
      ) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    // 5. Ordered list (1. 2. 3.)
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    // 6. Empty line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // 7. Paragraph
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].trim().startsWith("```") &&
      !/^#{1,3}(?:\s|$)/.test(lines[i].trim()) &&
      !lines[i].trim().startsWith(">") &&
      (!/^\s*[-*•]\s+/.test(lines[i]) || /^\s*\*+[^*]+\*+\s*$/.test(lines[i])) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: "p", text: paraLines.join(" ") });
    }

    // Absolute failsafe: guarantee forward progress on any malformed input
    if (i === startI) {
      blocks.push({ type: "p", text: lines[i] });
      i++;
    }
  }

  return blocks;
}

export function MarkdownNotesRenderer({
  content,
  className,
  isCompact = false,
}: MarkdownNotesRendererProps) {
  if (!content || !content.trim()) {
    return (
      <div className="text-zinc-500 text-xs italic py-2">
        No notes yet. Click to write your approach, time complexity & edge cases.
      </div>
    );
  }

  const normalized = normalizeNotesContent(content);
  const blocks = parseBlocks(normalized);

  return (
    <div
      className={cn(
        "space-y-2.5 text-zinc-200 leading-relaxed font-sans select-text",
        isCompact ? "text-xs space-y-1 sm:space-y-1.5" : "text-xs sm:text-sm",
        className
      )}
    >
      {blocks.map((block, idx) => {
        switch (block.type) {
          case "h1":
            return (
              <h1
                key={idx}
                className={cn(
                  "font-bold text-white border-b border-white/10 pb-1 tracking-tight",
                  isCompact ? "text-xs sm:text-sm mt-0.5 mb-0.5 pb-0.5" : "text-base sm:text-lg mt-3 mb-1.5"
                )}
              >
                {renderInlineTokens(block.text || "")}
              </h1>
            );

          case "h2":
            return (
              <h2
                key={idx}
                className={cn(
                  "font-bold text-violet-300 tracking-tight",
                  isCompact ? "text-xs mt-0.5 mb-0.5" : "text-sm sm:text-base mt-2.5 mb-1"
                )}
              >
                {renderInlineTokens(block.text || "")}
              </h2>
            );

          case "h3":
            return (
              <h3
                key={idx}
                className={cn(
                  "font-semibold text-cyan-300 tracking-tight",
                  isCompact ? "text-[11px] mt-0.5 mb-0.5" : "text-xs sm:text-sm mt-2 mb-0.5"
                )}
              >
                {renderInlineTokens(block.text || "")}
              </h3>
            );

          case "quote":
            return (
              <blockquote
                key={idx}
                className={cn(
                  "border-l-2 border-violet-500/70 bg-violet-950/20 pl-3 pr-2 py-1 my-1.5 rounded-r-lg text-zinc-300 text-xs italic",
                  isCompact && "py-0.5 my-1 text-[11px]"
                )}
              >
                {renderInlineTokens(block.text || "")}
              </blockquote>
            );

          case "ul":
            return (
              <ul key={idx} className={cn("space-y-1 my-1 pl-1", isCompact && "space-y-0.5 my-0.5")}>
                {block.items?.map((item, i) => (
                  <li key={i} className="flex items-start gap-1.5 sm:gap-2 text-zinc-200 text-xs leading-relaxed">
                    <span className="w-1.5 h-1.5 rounded-full bg-violet-400 mt-1.5 shrink-0 shadow-sm shadow-violet-500/40" />
                    <span className="flex-1 min-w-0">{renderInlineTokens(item)}</span>
                  </li>
                ))}
              </ul>
            );

          case "ol":
            return (
              <ol key={idx} className={cn("space-y-1 my-1 pl-1 counter-reset-item", isCompact && "space-y-0.5 my-0.5")}>
                {block.items?.map((item, i) => (
                  <li key={i} className="flex items-start gap-1 sm:gap-2 text-zinc-200 text-xs leading-relaxed">
                    <span className="font-mono text-[10px] font-bold text-violet-400/90 shrink-0 mt-0.5 w-3.5 sm:w-4 text-right">
                      {i + 1}.
                    </span>
                    <span className="flex-1 min-w-0">{renderInlineTokens(item)}</span>
                  </li>
                ))}
              </ol>
            );

          case "code":
            return (
              <CollapsibleCodeBlock
                key={idx}
                code={block.text || ""}
                lang={block.lang}
                isCompact={isCompact}
              />
            );

          case "p":
          default:
            return (
              <p key={idx} className="text-zinc-200/95 leading-relaxed">
                {renderInlineTokens(block.text || "")}
              </p>
            );
        }
      })}
    </div>
  );
}
