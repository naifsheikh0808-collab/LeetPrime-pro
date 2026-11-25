"use client";

import React, { useEffect, useRef, useCallback, useState } from "react";
import {
  X,
  Bold,
  Italic,
  Underline,
  Highlighter,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  Code,
  Check,
  BookOpen,
  Download,
  ChevronDown,
  FileText,
  FileCode,
  File,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { tokenizeCode, getTokenClass } from "@/components/ai/PrimeAiMessageRenderer";

interface NotesEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  problemTitle: string;
  problemExternalId?: string | number;
  initialNotes: string;
  onSave: (notes: string) => void;
}

/**
 * Escapes characters that have HTML meaning inside code blocks.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Produces syntax-highlighted HTML spans for the code block in the notes editor.
 */
function highlightCodeHtml(code: string, lang = "cpp"): string {
  if (!code) return "<br>";
  const tokens = tokenizeCode(code, lang || "cpp");
  return tokens
    .map((t) => {
      const cls = getTokenClass(t.type, t.value);
      const val = escapeHtml(t.value);
      if (t.type === "plain") {
        return val;
      }
      return `<span class="${cls}">${val}</span>`;
    })
    .join("");
}

/**
 * Extracts raw multiline text from a code DOM element (recursively) without losing newlines.
 */
function extractCodeText(codeEl: Node): string {
  function walk(node: Node, isRoot = false): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent || "").replace(/\u200B/g, "");
    }
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
      return "";
    }
    const tag = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement).tagName.toLowerCase() : "";
    if (tag === "br") {
      return "\n";
    }

    const children = Array.from(node.childNodes);
    let out = "";
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const childTag = child.nodeType === Node.ELEMENT_NODE ? (child as HTMLElement).tagName.toLowerCase() : "";

      if (childTag === "div" || childTag === "p") {
        // Check if it's an empty block containing only a placeholder <br>
        const childText = (child.textContent || "").replace(/\u200B/g, "");
        const hasOnlyBr = !childText && child.childNodes.length === 1 && (child.firstChild as HTMLElement)?.tagName?.toLowerCase() === "br";
        if (out.length > 0 && !out.endsWith("\n")) {
          out += "\n";
        }
        if (hasOnlyBr) {
          out += "\n";
        } else {
          out += walk(child, false);
        }
      } else if (childTag === "br") {
        // Ignore a single trailing sentinel <br> when the entire <pre> is otherwise empty
        if (isRoot && children.length === 1 && out === "") {
          continue;
        }
        out += "\n";
      } else {
        out += walk(child, false);
      }
    }
    return out;
  }

  return walk(codeEl, true).replace(/\r\n|\r|\u2028|\u2029/g, "\n");
}

/**
 * Places a collapsed caret at a specific character offset inside a code <pre> element.
 */
function setCodeCaretOffset(codeEl: HTMLElement, targetOffset: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  const walker = document.createTreeWalker(codeEl, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, targetOffset);
  let node = walker.nextNode() as Text | null;
  let lastTextNode: Text | null = null;

  while (node) {
    lastTextNode = node;
    const len = node.data.length;
    if (remaining <= len) {
      const r = document.createRange();
      r.setStart(node, remaining);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }
    remaining -= len;
    node = walker.nextNode() as Text | null;
  }

  const r = document.createRange();
  if (lastTextNode) {
    r.setStart(lastTextNode, lastTextNode.data.length);
  } else {
    r.selectNodeContents(codeEl);
  }
  r.collapse(false);
  sel.removeAllRanges();
  sel.addRange(r);
}

interface HistorySnapshot {
  html: string;
  startOffset: number;
  endOffset: number;
}

function getDomOffset(root: Node, targetNode: Node, targetOffset: number): number {
  let pos = 0;
  let found = false;

  function walk(node: Node): void {
    if (found) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const len = (node.textContent || "").length;
      if (node === targetNode) {
        pos += Math.min(targetOffset, len);
        found = true;
        return;
      }
      pos += len;
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const children = el.childNodes;
      pos += 1;
      for (let i = 0; i < children.length; i++) {
        if (node === targetNode && i === targetOffset) {
          found = true;
          return;
        }
        walk(children[i]);
        if (found) return;
      }
      if (node === targetNode && targetOffset >= children.length) {
        found = true;
        return;
      }
      pos += 1;
    }
  }

  walk(root);
  return pos;
}

function resolveDomOffset(root: Node, targetPos: number): { node: Node; offset: number } | null {
  let pos = 0;
  let result: { node: Node; offset: number } | null = null;

  function walk(node: Node): void {
    if (result) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const len = (node.textContent || "").length;
      if (targetPos >= pos && targetPos <= pos + len) {
        result = { node, offset: targetPos - pos };
        return;
      }
      pos += len;
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const children = el.childNodes;
      pos += 1;
      for (let i = 0; i < children.length; i++) {
        if (pos === targetPos) {
          if (children[i].nodeType === Node.TEXT_NODE) {
            result = { node: children[i], offset: 0 };
          } else {
            result = { node: el, offset: i };
          }
          return;
        }
        walk(children[i]);
        if (result) return;
      }
      if (pos === targetPos) {
        result = { node: el, offset: children.length };
        return;
      }
      pos += 1;
    }
  }

  walk(root);
  return result;
}

/**
 * Generates interactive collapsible code block HTML for the WYSIWYG editor.
 * Includes colorful syntax highlighting, interchangeable "Exit to notes / Expand", and delete button.
 */
function createCodeBlockHtml(code: string, lang = "code", isCollapsed = true): string {
  const lines = code.split("\n");
  const lineCount = code.trim() ? lines.length : 1;
  const highlightedCode = highlightCodeHtml(code, lang);

  const chevronText = isCollapsed ? "▶" : "▼";
  const hiddenCls = isCollapsed ? " hidden" : "";
  const toggleBtnText = isCollapsed ? "Expand ↗" : "Exit to notes ↓";
  const toggleAction = isCollapsed ? "expand-code" : "exit-code";

  return (
    `<div class="code-block-container my-3 rounded-xl border border-white/10 bg-[#080914] overflow-hidden select-none" contenteditable="false" data-lang="code">` +
      `<div class="code-block-header flex items-center justify-between px-3 py-1.5 bg-white/[0.04] border-b border-white/[0.08] text-xs text-zinc-400 cursor-pointer hover:bg-white/[0.07] transition-colors" data-action="toggle-collapse">` +
        `<div class="flex items-center gap-2">` +
          `<span class="code-chevron text-[11px] text-violet-400 font-bold">${chevronText}</span>` +
          `<span class="code-lang-badge px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 text-[10px] font-mono font-bold">Code</span>` +
          `<span class="code-line-count text-[11px] text-zinc-400 font-mono">${lineCount} ${lineCount === 1 ? "line" : "lines"}${isCollapsed ? " (collapsed)" : ""}</span>` +
        `</div>` +
        `<div class="flex items-center gap-2.5">` +
          `<button type="button" class="code-toggle-btn text-[10px] font-medium text-violet-400 hover:text-violet-300 transition-colors cursor-pointer" data-action="${toggleAction}">${toggleBtnText}</button>` +
          `<button type="button" class="code-delete-btn p-1 rounded hover:bg-red-500/20 text-zinc-400 hover:text-red-400 transition-colors cursor-pointer flex items-center justify-center" data-action="delete-code" title="Delete code block"><svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>` +
        `</div>` +
      `</div>` +
      `<pre class="code-content p-3 min-h-[3.25rem] text-xs font-mono text-slate-100 leading-relaxed overflow-x-auto whitespace-pre outline-none select-text${hiddenCls}" contenteditable="true" spellcheck="false">${highlightedCode}</pre>` +
    `</div><p><br></p>`
  );
}

/**
 * Converts Markdown string to HTML for the WYSIWYG contentEditable editor.
 * Accurately parses ```lang fenced code blocks into collapsible interactive blocks.
 */
function markdownToHtml(md: string): string {
  if (!md || !md.trim()) return "<p><br></p>";
  const trimmedMd = md.replace(/^(?:\r?\n)+|\s+$/g, "");

  // If already legacy HTML format without markdown fences, return directly (cleansed of legacy atomic blocks)
  if (/^<(p|div|h1|h2|ul|ol|pre)\b/i.test(trimmedMd) && !trimmedMd.includes("```")) {
    return trimmedMd.replace(/\s*inline-block\s+align-baseline/g, "");
  }

  const formatInline = (str: string) => {
    const cleanInput = str.replace(/\u200B/g, "");
    // Protect inline code/highlight backtick spans first so underscores/asterisks inside them aren't mangled
    const codeTokens: string[] = [];
    const withCodePlaceholders = cleanInput.replace(/`([^`]+)`/g, (_m, inner) => {
      const idx = codeTokens.length;
      codeTokens.push(
        `<code class="prime-highlight bg-amber-400/25 border border-amber-400/50 text-amber-200 shadow-[0_0_10px_rgba(245,158,11,0.2)] font-mono text-[12px] font-semibold px-1.5 py-0.5 rounded-md mx-0.5">${inner
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</code>`
      );
      return `\uE000CODE${idx}\uE001`;
    });

    // Preserve valid <u> and <mark> tags while escaping bare HTML brackets
    // Also strip empty <u></u> and normalize mixed *<u> or <u>*
    const safe = withCodePlaceholders
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/&lt;u\b[^&]*&gt;\s*&lt;\/u&gt;/gi, "")
      .replace(/&lt;u\b[^&]*&gt;(.*?)&lt;\/u&gt;/gi, "<u>$1</u>")
      .replace(/&lt;\/?u\b[^&]*&gt;/gi, "")
      .replace(/\*\s*<u>([\s\S]*?)<\/u>\s*\*/gi, "<u><i>$1</i></u>")
      .replace(/<u>\s*\*([\s\S]*?)\*\s*<\/u>/gi, "<u><i>$1</i></u>")
      .replace(
        /&lt;mark\b[^&]*&gt;(.*?)&lt;\/mark&gt;/gi,
        '<code class="prime-highlight bg-amber-400/25 border border-amber-400/50 text-amber-200 shadow-[0_0_10px_rgba(245,158,11,0.2)] font-mono text-[12px] font-semibold px-1.5 py-0.5 rounded-md mx-0.5">$1</code>'
      );

    return safe
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      // Only treat __text__ as underline if it contains real word chars and isn't a diagram run like ____ or __|__
      .replace(/(?<!_)__(?!_)(?!\s)([^_\r\n]*[a-zA-Z0-9][^_\r\n]*)(?<!\s)__(?!_)/g, "<u>$1</u>")
      .replace(/\*([^*]+?)\*/g, "<i>$1</i>")
      .replace(/(?<!\w)_(?!\s)([^_\r\n]*[a-zA-Z0-9][^_\r\n]*)(?<!\s)_(?!\w)/g, "<i>$1</i>")
      .replace(/\uE000CODE(\d+)\uE001/g, (_m, idxStr) => codeTokens[Number(idxStr)] || "");
  };

  const lines = trimmedMd.split(/\r?\n/);
  const result: string[] = [];
  let inUl = false;
  let inOl = false;
  let inCode = false;
  let codeLang = "";
  let codeLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Fenced Code Block start / end
    if (trimmed.startsWith("```")) {
      if (inCode) {
        // Close code block (ALWAYS collapsed by default when opening notes)
        inCode = false;
        result.push(createCodeBlockHtml(codeLines.join("\n"), codeLang, true));
        codeLines = [];
        codeLang = "";
      } else {
        // Open code block
        if (inUl) { result.push("</ul>"); inUl = false; }
        if (inOl) { result.push("</ol>"); inOl = false; }
        inCode = true;
        codeLang = trimmed.slice(3).trim();
        codeLines = [];
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (trimmed.startsWith("### ")) {
      if (inUl) { result.push("</ul>"); inUl = false; }
      if (inOl) { result.push("</ol>"); inOl = false; }
      result.push(`<h2>${formatInline(trimmed.slice(4))}</h2>`);
    } else if (trimmed.startsWith("## ")) {
      if (inUl) { result.push("</ul>"); inUl = false; }
      if (inOl) { result.push("</ol>"); inOl = false; }
      result.push(`<h2>${formatInline(trimmed.slice(3))}</h2>`);
    } else if (trimmed.startsWith("# ")) {
      if (inUl) { result.push("</ul>"); inUl = false; }
      if (inOl) { result.push("</ol>"); inOl = false; }
      result.push(`<h1>${formatInline(trimmed.slice(2))}</h1>`);
    } else if (
      (trimmed.startsWith("- ") || trimmed.startsWith("* ")) &&
      !/^\s*\*+[^*]+\*+\s*$/.test(line)
    ) {
      if (inOl) { result.push("</ol>"); inOl = false; }
      if (!inUl) { result.push("<ul>"); inUl = true; }
      result.push(`<li>${formatInline(trimmed.slice(2))}</li>`);
    } else if (/^\d+\.\s/.test(trimmed)) {
      if (inUl) { result.push("</ul>"); inUl = false; }
      if (!inOl) { result.push("<ol>"); inOl = true; }
      const content = trimmed.replace(/^\d+\.\s/, "");
      result.push(`<li>${formatInline(content)}</li>`);
    } else if (trimmed === "") {
      // Don't insert unnecessary extra enter <p><br></p> if:
      // 1. Right after or right before a heading (headings already have vertical margins)
      // 2. Right after or right before a code block (code blocks already have vertical margins)
      // 3. Right after another <p><br></p> (avoid stacking empty enters)
      const prev = result[result.length - 1] || "";
      const isAfterHeading = /<\/(h1|h2|h3)>$/i.test(prev);
      const isAfterCode = prev.includes("code-block-container");
      const nextLine = (lines[i + 1] || "").trim();
      const isBeforeCode = nextLine.startsWith("```");
      const isBeforeHeading = /^#{1,3}\s/.test(nextLine);

      if (isAfterHeading || isAfterCode || isBeforeCode || isBeforeHeading) {
        continue;
      }
      if (prev.endsWith("<p><br></p>")) {
        continue;
      }

      if (inUl) { result.push("</ul>"); inUl = false; }
      if (inOl) { result.push("</ol>"); inOl = false; }
      result.push("<p><br></p>");
    } else {
      if (inUl) { result.push("</ul>"); inUl = false; }
      if (inOl) { result.push("</ol>"); inOl = false; }
      result.push(`<p>${formatInline(line)}</p>`);
    }
  }

  if (inCode) {
    result.push(createCodeBlockHtml(codeLines.join("\n"), codeLang, true));
  }
  if (inUl) result.push("</ul>");
  if (inOl) result.push("</ol>");

  // Ensure editor ends with a normal paragraph for easy typing
  const finalHtml = result.join("");
  if (!finalHtml.endsWith("<p><br></p>") && !finalHtml.endsWith("</p>")) {
    return finalHtml + "<p><br></p>";
  }
  return finalHtml;
}

/**
 * Converts WYSIWYG HTML back to clean, compact Markdown string for storage.
 * Accurately extracts code from collapsible code containers without line loss
 * and prevents extraneous blank lines around headings, code blocks, and paragraphs.
 */
function htmlToMarkdown(html: string): string {
  if (!html || !html.trim()) return "";
  if (typeof document === "undefined") return html;

  const temp = document.createElement("div");
  temp.innerHTML = html;

  function serializeInline(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent || "").replace(/\u200B/g, "").replace(/\u00A0/g, " ");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    const wrapPerLine = (raw: string, open: string, close: string) => {
      const cleaned = raw.replace(/\u200B/g, "");
      if (!cleaned.trim()) return "";
      const wrapOne = (line: string) => {
        if (!line.trim()) return line;
        const lead = line.match(/^\s*/)?.[0] || "";
        const trail = line.match(/\s*$/)?.[0] || "";
        return `${lead}${open}${line.trim()}${close}${trail}`;
      };
      if (!cleaned.includes("\n")) {
        return wrapOne(cleaned);
      }
      return cleaned.split("\n").map(wrapOne).join("\n");
    };

    // Inline code or Prime AI highlight
    if (tag === "code" || tag === "mark") {
      const inner = (el.textContent || "").replace(/\u200B/g, "").replace(/\u00A0/g, " ").trim();
      return inner ? `\`${inner.replace(/`/g, "")}\`` : "";
    }
    // Bold
    if (tag === "b" || tag === "strong") {
      const inner = Array.from(el.childNodes).map(serializeInline).join("");
      return wrapPerLine(inner, "**", "**");
    }
    // Italic
    if (tag === "i" || tag === "em") {
      const inner = Array.from(el.childNodes).map(serializeInline).join("");
      return wrapPerLine(inner, "*", "*");
    }
    // Underline
    if (tag === "u") {
      const inner = Array.from(el.childNodes).map(serializeInline).join("");
      return wrapPerLine(inner, "<u>", "</u>");
    }
    if (tag === "br") {
      return "\n";
    }
    return Array.from(el.childNodes).map(serializeInline).join("");
  }

  const blocks: string[] = [];

  function processBlockNode(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || "";
      if (text.trim()) {
        blocks.push(text.trim());
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    // 1. Collapsible Code Block Container or pre
    if (el.classList.contains("code-block-container") || tag === "pre") {
      const pre = (el.querySelector(".code-content") as HTMLElement) || el;
      const lang = el.getAttribute("data-lang") || "";
      const code = extractCodeText(pre).trimEnd();
      blocks.push(`\`\`\`${lang}\n${code}\n\`\`\``);
      return;
    }

    // 2. Headings
    if (tag === "h1") {
      const inner = serializeInline(el).trim();
      if (inner) blocks.push(`# ${inner}`);
      return;
    }
    if (tag === "h2") {
      const inner = serializeInline(el).trim();
      if (inner) blocks.push(`## ${inner}`);
      return;
    }
    if (tag === "h3") {
      const inner = serializeInline(el).trim();
      if (inner) blocks.push(`### ${inner}`);
      return;
    }

    // 3. Lists
    if (tag === "ul") {
      const items = Array.from(el.querySelectorAll(":scope > li"))
        .map((li) => `- ${serializeInline(li).trim()}`)
        .join("\n");
      if (items) blocks.push(items);
      return;
    }
    if (tag === "ol") {
      const items = Array.from(el.querySelectorAll(":scope > li"))
        .map((li, idx) => `${idx + 1}. ${serializeInline(li).trim()}`)
        .join("\n");
      if (items) blocks.push(items);
      return;
    }

    // 4. Paragraph
    if (tag === "p") {
      const text = el.textContent || "";
      const isBlank =
        (!text.trim() && el.querySelectorAll("br").length > 0) ||
        (!text.trim() && el.children.length === 0);
      if (isBlank) {
        blocks.push("");
        return;
      }
      const inner = serializeInline(el);
      blocks.push(inner);
      return;
    }

    // 5. Generic Div / Wrapper
    if (tag === "div") {
      const hasBlockChildren = el.querySelector("p, h1, h2, h3, ul, ol, pre, .code-block-container");
      if (hasBlockChildren) {
        Array.from(el.childNodes).forEach(processBlockNode);
        return;
      }
      const text = el.textContent || "";
      const isBlank =
        (!text.trim() && el.querySelectorAll("br").length > 0) ||
        (!text.trim() && el.children.length === 0);
      if (isBlank) {
        blocks.push("");
        return;
      }
      const inner = serializeInline(el);
      blocks.push(inner);
      return;
    }

    // Fallback: child elements (span, etc.)
    const inner = serializeInline(el);
    if (inner.trim()) {
      blocks.push(inner);
    }
  }

  Array.from(temp.childNodes).forEach(processBlockNode);

  return blocks
    .join("\n")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^(?:\r?\n)+|\s+$/g, "");
}

/**
 * Converts Markdown string to clean plain text for .txt export,
 * ensuring all code blocks are fully included even if collapsed in the UI,
 * while removing visual markdown formatting syntax and UI buttons.
 */
function markdownToPlainText(md: string): string {
  if (!md) return "";
  return md
    // Clean code blocks: include the full code lines with clean text dividers (preserve indentation)
    .replace(/```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)```/g, (_match, code: string) => {
      const cleanCode = code.replace(/^\n+|\s+$/g, "");
      return `\n${"-".repeat(25)} Code ${"-".repeat(25)}\n${cleanCode}\n${"-".repeat(56)}\n`;
    })
    // Headings
    .replace(/^#{1,6}\s+(.*)$/gm, "$1")
    // Bold, Underline, Italic (preserve diagram underscores like ____)
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(?<!_)__(?!_)(?!\s)([^_\r\n]*[a-zA-Z0-9][^_\r\n]*)(?<!\s)__(?!_)/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/(?<!\w)_(?!\s)([^_\r\n]*[a-zA-Z0-9][^_\r\n]*)(?<!\s)_(?!\w)/g, "$1")
    .replace(/<u>(.*?)<\/u>/gi, "$1")
    // Inline code / highlight badges
    .replace(/`([^`]+)`/g, "$1")
    // HTML tags if any
    .replace(/<[^>]+>/g, "")
    // Clean redundant blank lines
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^(?:\r?\n)+|\s+$/g, "");
}

function isDiagramLineText(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^#{1,6}\s/.test(trimmed) || trimmed.startsWith("```")) return false;
  if (/[┌┐└┘├┤┬┴┼─│═║╔╗╚╝╠╣╦╩╬▼▲►◄]/.test(line)) return true;
  if (/_{3,}|-{3,}/.test(line)) return true;
  if (/(?:^\s*\||\|\s*$|\S\s*\|\s*\S|\|\s{2,})/.test(line)) return true;
  if (/^\s{2,}\S/.test(line)) return true;
  if (/\S\s{3,}\S/.test(line)) return true;
  return false;
}

function hasExplicitDiagramStructure(line: string): boolean {
  return /_{3,}|-{3,}|[┌┐└┘├┤┬┴┼─│═║╔╗╚╝╠╣╦╩╬▼▲►◄]|^\s*\|/.test(line);
}

function escapeHtmlAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Exports editor content as Markdown, Plain Text, or Print-Ready PDF HTML while
 * pixel-realigning mindmaps/ASCII diagrams from the editor's proportional font
 * to exact monospace columns.
 */
function exportNotesFromEditor(editorEl: HTMLElement, mode: "md" | "txt" | "pdfHtml"): string {
  // Determine monospace column pixel width using rendered underscore/dash runs in the editor
  let colWidth = 0;
  const widthSamples: number[] = [];
  const pNodes = Array.from(editorEl.querySelectorAll("p"));
  for (const p of pNodes) {
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let tn = walker.nextNode() as Text | null;
    while (tn) {
      const m = (tn.textContent || "").match(/_{3,}|-{3,}/);
      if (m && m.index !== undefined) {
        try {
          const r = document.createRange();
          r.setStart(tn, m.index);
          r.setEnd(tn, m.index + m[0].length);
          const w = r.getBoundingClientRect().width;
          if (w > 0) widthSamples.push(w / m[0].length);
        } catch {}
      }
      tn = walker.nextNode() as Text | null;
    }
    if (widthSamples.length >= 3) break;
  }
  if (widthSamples.length > 0) {
    colWidth = widthSamples.reduce((a, b) => a + b, 0) / widthSamples.length;
  } else {
    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.font = window.getComputedStyle(editorEl).font || "16px sans-serif";
        colWidth = ctx.measureText("_").width || 7.5;
      }
    } catch {}
    if (!colWidth || colWidth <= 0) colWidth = 7.5;
  }

  interface MonoToken {
    kind: "space" | "text" | "hl";
    text: string;
  }

  interface BuiltMonoLine {
    plainText: string;
    tokens: MonoToken[];
  }

  // Measure and split a single <p>/<div> into visual lines with exact monospace column tokens
  const buildMonoLinesForBlock = (blockEl: HTMLElement): BuiltMonoLine[] => {
    const blockRect = blockEl.getBoundingClientRect();
    const blockLeft = blockRect.left;

    interface VisualPart {
      kind: "text" | "hl";
      text: string;
      leftPx: number;
    }
    interface VisualSeg {
      parts: VisualPart[];
      leftPx: number;
    }
    const visualLines: VisualSeg[][] = [[]];
    let currentSeg: VisualSeg | null = null;

    const flushSeg = () => {
      if (currentSeg && currentSeg.parts.length > 0) {
        visualLines[visualLines.length - 1].push(currentSeg);
      }
      currentSeg = null;
    };

    const appendPart = (kind: "text" | "hl", txt: string, leftPx: number) => {
      if (!txt) return;
      if (!currentSeg) {
        currentSeg = { parts: [{ kind, text: txt, leftPx }], leftPx };
      } else {
        const last = currentSeg.parts[currentSeg.parts.length - 1];
        if (last && last.kind === "text" && kind === "text") {
          last.text += txt;
        } else {
          currentSeg.parts.push({ kind, text: txt, leftPx });
        }
      }
    };

    const walkLineNodes = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const tn = node as Text;
        const raw = (tn.textContent || "").replace(/\u200B/g, "").replace(/\u00A0/g, " ");
        if (!raw) return;

        // Split on runs of 2+ spaces (or leading spaces only at start of line when !currentSeg)
        const gapRegex = currentSeg ? /\s{2,}/g : /\s{2,}|^\s+/g;
        let idx = 0;
        let match: RegExpExecArray | null;
        while ((match = gapRegex.exec(raw)) !== null) {
          if (match.index > idx) {
            const sub = raw.slice(idx, match.index);
            let leftPx = 0;
            try {
              const r = document.createRange();
              r.setStart(tn, idx);
              r.setEnd(tn, match.index);
              leftPx = r.getBoundingClientRect().left - blockLeft;
            } catch {}
            appendPart("text", sub, leftPx);
          }
          flushSeg();
          idx = match.index + match[0].length;
        }
        if (idx < raw.length) {
          const sub = raw.slice(idx);
          let leftPx = 0;
          try {
            const r = document.createRange();
            r.setStart(tn, idx);
            r.setEnd(tn, raw.length);
            leftPx = r.getBoundingClientRect().left - blockLeft;
          } catch {}
          appendPart("text", sub, leftPx);
        }
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();

      if (tag === "br") {
        flushSeg();
        visualLines.push([]);
        return;
      }

      if (el.classList.contains("prime-highlight") || tag === "code" || tag === "mark") {
        const inner = (el.textContent || "").replace(/\u200B/g, "").replace(/\u00A0/g, " ").trim();
        if (inner) {
          const leftPx = el.getBoundingClientRect().left - blockLeft;
          appendPart("hl", inner, leftPx);
        }
        return;
      }

      Array.from(el.childNodes).forEach(walkLineNodes);
    };

    Array.from(blockEl.childNodes).forEach(walkLineNodes);
    flushSeg();

    return visualLines.map((segs) => {
      if (segs.length === 0) return { plainText: "", tokens: [] };
      const tokens: MonoToken[] = [];
      let plainOut = "";
      let curCol = 0;

      for (const seg of segs) {
        // Trim leading spaces on first text part of segment
        const parts = [...seg.parts];
        if (parts[0] && parts[0].kind === "text") {
          const stripped = parts[0].text.replace(/^\s+/, "");
          if (!stripped) {
            parts.shift();
          } else {
            parts[0] = { ...parts[0], text: stripped };
          }
        }
        if (parts.length === 0) continue;

        const minGap = curCol === 0 ? 0 : 2;
        const targetCol = Math.max(
          curCol === 0 ? 0 : curCol + minGap,
          Math.round(seg.leftPx / colWidth)
        );
        if (targetCol > curCol) {
          const sp = " ".repeat(targetCol - curCol);
          tokens.push({ kind: "space", text: sp });
          plainOut += sp;
          curCol = targetCol;
        }

        for (let pIdx = 0; pIdx < parts.length; pIdx++) {
          let pText = parts[pIdx].text;
          if (pIdx === parts.length - 1 && parts[pIdx].kind === "text") {
            pText = pText.replace(/\s+$/, "");
          }
          if (!pText) continue;
          if (parts[pIdx].kind === "hl") {
            tokens.push({ kind: "hl", text: pText });
            const bracketed = `[${pText}]`;
            plainOut += bracketed;
            curCol += bracketed.length;
          } else {
            tokens.push({ kind: "text", text: pText });
            plainOut += pText;
            curCol += pText.length;
          }
        }
      }

      return { plainText: plainOut.trimEnd(), tokens };
    });
  };

  // Collect line entries across top-level editor children
  interface ExportEntry {
    isDiagramCandidate: boolean;
    isBlank: boolean;
    isFixedBlock: boolean;
    mdText: string;
    monoText: string;
    monoTokens: MonoToken[];
    rawHtml: string;
  }
  const entries: ExportEntry[] = [];

  const processChild = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.textContent || "").replace(/\u200B/g, "").replace(/\u00A0/g, " ");
      if (t.trim()) {
        entries.push({
          isDiagramCandidate: isDiagramLineText(t),
          isBlank: false,
          isFixedBlock: false,
          mdText: t.trimEnd(),
          monoText: t.trimEnd(),
          monoTokens: [{ kind: "text", text: t.trimEnd() }],
          rawHtml: `<p>${escapeHtmlAttr(t.trimEnd())}</p>`,
        });
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    if (
      el.classList.contains("code-block-container") ||
      tag === "pre" ||
      tag === "h1" ||
      tag === "h2" ||
      tag === "h3" ||
      tag === "ul" ||
      tag === "ol"
    ) {
      const singleMd = htmlToMarkdown(el.outerHTML);
      if (singleMd) {
        entries.push({
          isDiagramCandidate: false,
          isBlank: false,
          isFixedBlock: true,
          mdText: singleMd,
          monoText: markdownToPlainText(singleMd),
          monoTokens: [],
          rawHtml: el.outerHTML.replace(/\u200B/g, ""),
        });
      }
      return;
    }

    if (tag === "div" && el.querySelector("p, h1, h2, h3, ul, ol, pre, .code-block-container")) {
      Array.from(el.childNodes).forEach(processChild);
      return;
    }

    // Paragraph or generic inline div
    const textContent = (el.textContent || "").replace(/\u200B/g, "");
    const isBlank =
      (!textContent.trim() && el.querySelectorAll("br").length > 0) ||
      (!textContent.trim() && el.children.length === 0);

    if (isBlank) {
      entries.push({
        isDiagramCandidate: false,
        isBlank: true,
        isFixedBlock: false,
        mdText: "",
        monoText: "",
        monoTokens: [],
        rawHtml: "<p><br></p>",
      });
      return;
    }

    const mdBlock = htmlToMarkdown(el.outerHTML);
    const mdLines = mdBlock.split("\n");
    const monoLines = buildMonoLinesForBlock(el);
    const lineCount = Math.max(mdLines.length, monoLines.length);
    const cleanElHtml = el.outerHTML.replace(/\u200B/g, "");

    for (let i = 0; i < lineCount; i++) {
      const mdL = mdLines[i] ?? "";
      const monoObj = monoLines[i] ?? { plainText: mdL, tokens: [{ kind: "text" as const, text: mdL }] };
      const plainCheck = monoObj.plainText || mdL;
      entries.push({
        isDiagramCandidate: isDiagramLineText(plainCheck),
        isBlank: !plainCheck.trim(),
        isFixedBlock: false,
        mdText: mdL,
        monoText: monoObj.plainText,
        monoTokens: monoObj.tokens,
        rawHtml: i === 0 ? cleanElHtml : "",
      });
    }
  };

  Array.from(editorEl.childNodes).forEach(processChild);

  // Group contiguous diagram candidates into diagram blocks
  const outputChunks: string[] = [];
  let idx = 0;
  while (idx < entries.length) {
    if (entries[idx].isDiagramCandidate) {
      let end = idx + 1;
      while (end < entries.length && entries[end].isDiagramCandidate) {
        end++;
      }
      const run = entries.slice(idx, end);
      const isTrueDiagram =
        run.length >= 2 || run.some((item) => hasExplicitDiagramStructure(item.monoText));

      if (isTrueDiagram) {
        if (mode === "pdfHtml") {
          const maxLen = run.reduce((m, r) => Math.max(m, r.monoText.length), 0);
          const diagramFontSize = maxLen > 92 ? "9.5px" : maxLen > 78 ? "10.5px" : "11.5px";
          const htmlLines = run.map((r) => {
            if (r.monoTokens.length === 0) return escapeHtmlAttr(r.monoText);
            return r.monoTokens
              .map((tok) => {
                if (tok.kind === "space") return tok.text;
                if (tok.kind === "hl") {
                  const chWidth = tok.text.length + 2;
                  return `<span class="pdf-diagram-hl" style="width:${chWidth}ch;">${escapeHtmlAttr(tok.text)}</span>`;
                }
                return escapeHtmlAttr(tok.text);
              })
              .join("");
          });
          outputChunks.push(
            `<pre class="pdf-diagram" style="font-size:${diagramFontSize};">${htmlLines.join("\n")}</pre>`
          );
        } else {
          const monoBlock = run.map((r) => r.monoText).join("\n");
          if (mode === "md") {
            outputChunks.push(`\`\`\`text\n${monoBlock}\n\`\`\``);
          } else {
            outputChunks.push(monoBlock);
          }
        }
        idx = end;
        continue;
      }
    }

    const item = entries[idx];
    if (mode === "pdfHtml") {
      if (item.rawHtml) {
        outputChunks.push(item.rawHtml);
      } else if (item.isBlank) {
        outputChunks.push("<p><br></p>");
      } else if (item.monoText) {
        outputChunks.push(`<p>${escapeHtmlAttr(item.monoText)}</p>`);
      }
    } else if (item.isFixedBlock) {
      outputChunks.push(mode === "md" ? item.mdText : item.monoText);
    } else if (item.isBlank) {
      outputChunks.push("");
    } else {
      outputChunks.push(mode === "md" ? item.mdText : markdownToPlainText(item.mdText));
    }
    idx++;
  }

  if (mode === "pdfHtml") {
    return outputChunks.join("");
  }

  return outputChunks
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^(?:\r?\n)+|\s+$/g, "");
}

export function NotesEditorModal({
  isOpen,
  onClose,
  problemTitle,
  problemExternalId,
  initialNotes,
  onSave,
}: NotesEditorModalProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const wordCountRef = useRef<HTMLSpanElement>(null);
  const saveStatusRef = useRef<HTMLSpanElement>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const wasOpenRef = useRef(false);
  const lastSavedMdRef = useRef(initialNotes);
  const historyRef = useRef<HistorySnapshot[]>([]);
  const historyIndexRef = useRef(-1);
  const historyDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const isRestoringHistoryRef = useRef(false);
  const toggleHighlightRef = useRef<() => void>(() => {});

  const [isExportOpen, setIsExportOpen] = useState(false);
  const exportDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isExportOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(e.target as Node)) {
        setIsExportOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isExportOpen]);

  const [activeFormats, setActiveFormats] = useState({
    bold: false,
    italic: false,
    underline: false,
    highlight: false,
    h1: false,
    h2: false,
    ul: false,
    ol: false,
    code: false,
  });

  const checkActiveFormats = useCallback(() => {
    if (typeof document === "undefined" || !editorRef.current) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!editorRef.current.contains(range.commonAncestorContainer)) return;

    let bold = false;
    let italic = false;
    let underline = false;
    let highlight = false;
    let ul = false;
    let ol = false;
    let h1 = false;
    let h2 = false;
    let code = false;

    try {
      bold = document.queryCommandState("bold");
      italic = document.queryCommandState("italic");
      underline = document.queryCommandState("underline");
      ul = document.queryCommandState("insertUnorderedList");
      ol = document.queryCommandState("insertOrderedList");

      const block = (document.queryCommandValue("formatBlock") || "").toLowerCase();
      if (block === "h1") h1 = true;
      if (block === "h2") h2 = true;
      if (block === "pre") code = true;
    } catch {}

    let node: Node | null = range.commonAncestorContainer;
    while (node && node !== editorRef.current) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        const tag = el.tagName.toLowerCase();
        if (
          el.classList.contains("prime-highlight") ||
          tag === "mark" ||
          (tag === "code" && !el.closest(".code-block-container") && !el.closest("pre"))
        ) {
          highlight = true;
        }
        if (el.classList.contains("code-block-container") || el.classList.contains("code-content") || tag === "pre") {
          code = true;
        }
        if (tag === "h1") h1 = true;
        if (tag === "h2") h2 = true;
        if (tag === "b" || tag === "strong") bold = true;
        if (tag === "i" || tag === "em") italic = true;
        if (tag === "u") underline = true;
        if (tag === "ul") ul = true;
        if (tag === "ol") ol = true;
      }
      node = node.parentNode;
    }

    setActiveFormats({ bold, italic, underline, highlight, h1, h2, ul, ol, code });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onSelectionChange = () => checkActiveFormats();
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [isOpen, checkActiveFormats]);

  const captureSnapshot = useCallback((): HistorySnapshot | null => {
    if (!editorRef.current) return null;
    const html = editorRef.current.innerHTML;
    let startOffset = 0;
    let endOffset = 0;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (editorRef.current.contains(range.commonAncestorContainer)) {
        startOffset = getDomOffset(editorRef.current, range.startContainer, range.startOffset);
        endOffset = getDomOffset(editorRef.current, range.endContainer, range.endOffset);
      }
    }
    return { html, startOffset, endOffset };
  }, []);

  const pushHistorySnapshot = useCallback(
    (force = false) => {
      if (isRestoringHistoryRef.current) return;
      const snap = captureSnapshot();
      if (!snap) return;
      const current = historyRef.current[historyIndexRef.current];
      if (!force && current && current.html === snap.html) {
        return;
      }
      const nextStack = historyRef.current.slice(0, historyIndexRef.current + 1);
      nextStack.push(snap);
      if (nextStack.length > 100) {
        nextStack.shift();
      }
      historyRef.current = nextStack;
      historyIndexRef.current = nextStack.length - 1;
    },
    [captureSnapshot]
  );

  // Initialize editor content ONLY once when modal transitions from closed to open
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      wasOpenRef.current = true;
      lastSavedMdRef.current = initialNotes;
      if (editorRef.current) {
        const html = markdownToHtml(initialNotes || "");
        editorRef.current.innerHTML = html;

        // Seed undo/redo history stack with initial snapshot
        historyRef.current = [{ html, startOffset: 0, endOffset: 0 }];
        historyIndexRef.current = 0;

        // Initialize word count directly on DOM
        if (wordCountRef.current) {
          const text = editorRef.current.innerText || "";
          const trimmed = text.trim();
          const count = trimmed ? trimmed.split(/\s+/).length : 0;
          wordCountRef.current.textContent = `${count} words`;
        }
        if (saveStatusRef.current) {
          saveStatusRef.current.textContent = "Saved";
          saveStatusRef.current.className = "text-[11px] font-medium text-emerald-400/90 hidden sm:inline";
        }

        // Focus editor
        setTimeout(() => {
          if (editorRef.current) {
            editorRef.current.focus();
            checkActiveFormats();
          }
        }, 50);
      }
    } else if (!isOpen) {
      wasOpenRef.current = false;
      if (historyDebounceRef.current) {
        clearTimeout(historyDebounceRef.current);
      }
    }
  }, [isOpen, initialNotes, checkActiveFormats]);

  // Handle saving and closing safely
  const handleSaveAndClose = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    if (historyDebounceRef.current) {
      clearTimeout(historyDebounceRef.current);
    }
    try {
      if (editorRef.current) {
        const md = htmlToMarkdown(editorRef.current.innerHTML);
        lastSavedMdRef.current = md;
        onSave(md);
      }
    } catch (err) {
      console.error("[NotesEditorModal] Error saving notes:", err);
    } finally {
      onClose();
    }
  }, [onSave, onClose]);

  const scheduleAutoSaveAndCounts = useCallback(() => {
    if (wordCountRef.current && editorRef.current) {
      const text = editorRef.current.innerText || "";
      const trimmed = text.trim();
      const count = trimmed ? trimmed.split(/\s+/).length : 0;
      wordCountRef.current.textContent = `${count} words`;
    }

    if (saveStatusRef.current) {
      saveStatusRef.current.textContent = "Saving...";
      saveStatusRef.current.className = "text-[11px] font-medium text-amber-400/90 hidden sm:inline";
    }

    checkActiveFormats();

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      try {
        if (editorRef.current) {
          const md = htmlToMarkdown(editorRef.current.innerHTML);
          if (md !== lastSavedMdRef.current) {
            lastSavedMdRef.current = md;
            onSave(md);
          }
        }
      } catch (err) {
        console.error("[NotesEditorModal] Auto-save error:", err);
      } finally {
        if (saveStatusRef.current) {
          saveStatusRef.current.textContent = "Saved";
          saveStatusRef.current.className = "text-[11px] font-medium text-emerald-400/90 hidden sm:inline";
        }
      }
    }, 2000);
  }, [checkActiveFormats, onSave]);

  const restoreHistorySnapshot = useCallback(
    (snap: HistorySnapshot) => {
      if (!editorRef.current) return;
      isRestoringHistoryRef.current = true;
      try {
        editorRef.current.innerHTML = snap.html;
        const start = resolveDomOffset(editorRef.current, snap.startOffset);
        const end = resolveDomOffset(editorRef.current, snap.endOffset);
        const sel = window.getSelection();
        if (sel && start && end) {
          const r = document.createRange();
          r.setStart(start.node, start.offset);
          r.setEnd(end.node, end.offset);
          sel.removeAllRanges();
          sel.addRange(r);
        }
        scheduleAutoSaveAndCounts();
      } finally {
        isRestoringHistoryRef.current = false;
      }
    },
    [scheduleAutoSaveAndCounts]
  );

  const undoHistory = useCallback(() => {
    if (!editorRef.current) return;
    if (historyDebounceRef.current) {
      clearTimeout(historyDebounceRef.current);
      historyDebounceRef.current = null;
    }
    // Flush any pending typed text since the last snapshot before stepping back
    const currentHtml = editorRef.current.innerHTML;
    const activeSnap = historyRef.current[historyIndexRef.current];
    if (activeSnap && activeSnap.html !== currentHtml) {
      pushHistorySnapshot(true);
    }
    if (historyIndexRef.current > 0) {
      historyIndexRef.current -= 1;
      restoreHistorySnapshot(historyRef.current[historyIndexRef.current]);
    }
  }, [pushHistorySnapshot, restoreHistorySnapshot]);

  const redoHistory = useCallback(() => {
    if (historyDebounceRef.current) {
      clearTimeout(historyDebounceRef.current);
      historyDebounceRef.current = null;
    }
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyIndexRef.current += 1;
      restoreHistorySnapshot(historyRef.current[historyIndexRef.current]);
    }
  }, [restoreHistorySnapshot]);

  // Handle typing & content change without triggering ANY React re-renders (zero thread blocking)
  const handleInput = (skipHistoryDebounce = false) => {
    // 0. Clean up any zero-width space in any text node that has real text
    if (editorRef.current) {
      const walker = document.createTreeWalker(editorRef.current, NodeFilter.SHOW_TEXT);
      let textNode = walker.nextNode() as Text | null;
      while (textNode) {
        if (textNode.data.includes("\u200B") && textNode.data.length > 1) {
          const sel = window.getSelection();
          let currentOffset = -1;
          let isCurrentNode = false;
          if (sel && sel.rangeCount > 0) {
            const r = sel.getRangeAt(0);
            if (r.startContainer === textNode) {
              isCurrentNode = true;
              currentOffset = r.startOffset;
            }
          }
          const zwsIndex = textNode.data.indexOf("\u200B");
          textNode.data = textNode.data.replace(/\u200B/g, "");
          if (isCurrentNode && sel && currentOffset >= 0) {
            const newOffset = zwsIndex < currentOffset ? Math.max(0, currentOffset - 1) : currentOffset;
            const newR = document.createRange();
            newR.setStart(textNode, Math.min(newOffset, textNode.data.length));
            newR.collapse(true);
            sel.removeAllRanges();
            sel.addRange(newR);
          }
        }
        textNode = walker.nextNode() as Text | null;
      }
    }

    scheduleAutoSaveAndCounts();

    if (!skipHistoryDebounce && !isRestoringHistoryRef.current) {
      if (historyDebounceRef.current) {
        clearTimeout(historyDebounceRef.current);
      }
      historyDebounceRef.current = setTimeout(() => {
        pushHistorySnapshot();
        historyDebounceRef.current = null;
      }, 300);
    }
  };

  // Keyboard shortcuts (Escape, Ctrl+Enter, Ctrl+H for highlight, Ctrl+Z/Y for undo/redo)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;
      if (e.key === "Escape") {
        e.preventDefault();
        handleSaveAndClose();
      } else if (isMod && e.key === "Enter") {
        e.preventDefault();
        handleSaveAndClose();
      } else if (isMod && (e.key === "h" || e.key === "H")) {
        e.preventDefault();
        toggleHighlightRef.current();
      } else if (isMod && !e.altKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) {
          redoHistory();
        } else {
          undoHistory();
        }
      } else if (isMod && !e.altKey && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        redoHistory();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleSaveAndClose, undoHistory, redoHistory]);

  if (!isOpen) return null;

  // Execute formatting command on text selection
  const execCmd = (command: string, value: string | undefined = undefined) => {
    if (typeof document !== "undefined") {
      pushHistorySnapshot();
      document.execCommand(command, false, value);
      handleInput(true);
      pushHistorySnapshot(true);
      checkActiveFormats();
      if (editorRef.current) {
        editorRef.current.focus();
      }
    }
  };

  // Toggle heading level or revert to normal paragraph if already active
  const toggleHeading = (tag: "H1" | "H2") => {
    if (typeof document === "undefined") return;
    pushHistorySnapshot();
    try {
      const currentBlock = (document.queryCommandValue("formatBlock") || "").toUpperCase();
      if (currentBlock === tag) {
        document.execCommand("formatBlock", false, "<p>");
      } else {
        document.execCommand("formatBlock", false, `<${tag.toLowerCase()}>`);
      }
    } catch {
      document.execCommand("formatBlock", false, `<${tag.toLowerCase()}>`);
    }
    handleInput(true);
    pushHistorySnapshot(true);
    checkActiveFormats();
    if (editorRef.current) {
      editorRef.current.focus();
    }
  };

  // Helper to expand a collapsed code block
  const expandCodeBlock = (container: HTMLElement) => {
    const pre = container.querySelector(".code-content") as HTMLElement;
    const chevron = container.querySelector(".code-chevron") as HTMLElement;
    const lineCount = container.querySelector(".code-line-count") as HTMLElement;
    const toggleBtn = container.querySelector(".code-toggle-btn") as HTMLElement;
    if (!pre) return;

    pre.classList.remove("hidden");
    if (chevron) chevron.textContent = "▼";
    if (toggleBtn) {
      toggleBtn.textContent = "Exit to notes ↓";
      toggleBtn.setAttribute("data-action", "exit-code");
    }
    const text = extractCodeText(pre);
    const count = text.split("\n").filter((l) => l.length > 0).length || 1;
    if (lineCount) lineCount.textContent = `${count} ${count === 1 ? "line" : "lines"}`;
    pre.focus();
    checkActiveFormats();
  };

  // Helper to exit a code block into the paragraph below and collapse it
  const exitCodeBlock = (container: HTMLElement) => {
    const pre = container.querySelector(".code-content") as HTMLElement;
    const chevron = container.querySelector(".code-chevron") as HTMLElement;
    const lineCount = container.querySelector(".code-line-count") as HTMLElement;
    const toggleBtn = container.querySelector(".code-toggle-btn") as HTMLElement;
    if (pre) {
      pre.classList.add("hidden");
      if (chevron) chevron.textContent = "▶";
      if (toggleBtn) {
        toggleBtn.textContent = "Expand ↗";
        toggleBtn.setAttribute("data-action", "expand-code");
      }
      const text = extractCodeText(pre);
      const count = text.split("\n").filter((l) => l.length > 0).length || 1;
      if (lineCount) lineCount.textContent = `${count} ${count === 1 ? "line" : "lines"} (collapsed)`;
    }

    // Find or create normal paragraph below
    let nextEl = container.nextElementSibling as HTMLElement;
    if (!nextEl || nextEl.tagName.toLowerCase() !== "p") {
      const p = document.createElement("p");
      p.innerHTML = "<br>";
      container.parentNode?.insertBefore(p, container.nextSibling);
      nextEl = p;
    }

    // Move selection and focus to that paragraph
    const range = document.createRange();
    const sel = window.getSelection();
    range.setStart(nextEl, 0);
    range.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(range);
    nextEl.focus();

    handleInput();
    checkActiveFormats();
  };

  // Helper to toggle container collapse/expand
  const toggleContainerCollapse = (container: HTMLElement) => {
    const pre = container.querySelector(".code-content") as HTMLElement;
    if (!pre) return;

    if (pre.classList.contains("hidden")) {
      expandCodeBlock(container);
    } else {
      exitCodeBlock(container);
    }
  };

  // Toggle inline Prime AI highlight on selection or enable typing inside highlight
  const toggleHighlight = () => {
    if (typeof document === "undefined" || !editorRef.current) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);

    if (!editorRef.current.contains(range.commonAncestorContainer)) return;

    const isHighlightNode = (el: HTMLElement) =>
      el.classList.contains("prime-highlight") ||
      el.tagName.toLowerCase() === "mark" ||
      (el.tagName.toLowerCase() === "code" && !el.closest(".code-block-container") && !el.closest("pre"));

    // Record pre-mutation state for Ctrl+Z undo support
    pushHistorySnapshot();

    // Check if cursor or selection is already inside a single inline highlight element
    let existingHighlight: HTMLElement | null = null;
    let curr: Node | null = range.commonAncestorContainer;
    while (curr && curr !== editorRef.current) {
      if (curr.nodeType === Node.ELEMENT_NODE && isHighlightNode(curr as HTMLElement)) {
        existingHighlight = curr as HTMLElement;
        break;
      }
      curr = curr.parentNode;
    }

    const highlightClasses =
      "prime-highlight bg-amber-400/25 border border-amber-400/50 text-amber-200 shadow-[0_0_10px_rgba(245,158,11,0.2)] font-mono text-[12px] font-semibold px-1.5 py-0.5 rounded-md mx-0.5";

    const cleanupEmptyHighlights = () => {
      if (!editorRef.current) return;
      editorRef.current.querySelectorAll(".prime-highlight, mark, code").forEach((el) => {
        const htmlEl = el as HTMLElement;
        if (!htmlEl.closest(".code-block-container") && !htmlEl.closest("pre")) {
          const clean = (htmlEl.textContent || "").replace(/\u200B/g, "");
          if (clean.length === 0 && htmlEl !== existingHighlight) {
            htmlEl.remove();
          }
        }
      });
    };

    // CASE 1: Cursor or selection is ALREADY wholly inside a single highlight -> UNAPPLY or EXIT
    if (existingHighlight) {
      if (range.collapsed) {
        const cleanText = (existingHighlight.textContent || "").replace(/\u200B/g, "");
        if (!cleanText.trim()) {
          existingHighlight.remove();
          handleInput(true);
          pushHistorySnapshot(true);
          checkActiveFormats();
          return;
        }

        // Jump cursor out directly after the highlight element to resume typing normal text
        if (!existingHighlight.nextSibling) {
          const emptyText = document.createTextNode("\u200B");
          existingHighlight.parentNode?.appendChild(emptyText);
          const newRange = document.createRange();
          newRange.setStart(emptyText, 1);
          newRange.collapse(true);
          sel.removeAllRanges();
          sel.addRange(newRange);
        } else {
          const newRange = document.createRange();
          newRange.setStartAfter(existingHighlight);
          newRange.collapse(true);
          sel.removeAllRanges();
          sel.addRange(newRange);
        }
        checkActiveFormats();
        return;
      } else {
        const totalText = (existingHighlight.textContent || "").replace(/\u200B/g, "");
        const selectedText = range.toString().replace(/\u200B/g, "");

        // If the entire text was selected (even with trailing/leading space inside highlight), unwrap the whole element
        if (selectedText.trim() === totalText.trim() || selectedText.length >= totalText.length) {
          const parent = existingHighlight.parentNode;
          if (parent) {
            const firstChild = existingHighlight.firstChild;
            const lastChild = existingHighlight.lastChild;
            while (existingHighlight.firstChild) {
              parent.insertBefore(existingHighlight.firstChild, existingHighlight);
            }
            existingHighlight.remove();
            if (firstChild && lastChild) {
              const newRange = document.createRange();
              newRange.setStartBefore(firstChild);
              newRange.setEndAfter(lastChild);
              sel.removeAllRanges();
              sel.addRange(newRange);
            }
            handleInput(true);
            pushHistorySnapshot(true);
            checkActiveFormats();
            return;
          }
        }

        // Sub-text selected: split into [beforeText, selectedText, afterText]
        const preRange = document.createRange();
        preRange.selectNodeContents(existingHighlight);
        preRange.setEnd(range.startContainer, range.startOffset);
        const beforeText = (preRange.toString() || "").replace(/\u200B/g, "");

        const postRange = document.createRange();
        postRange.selectNodeContents(existingHighlight);
        postRange.setStart(range.endContainer, range.endOffset);
        const afterText = (postRange.toString() || "").replace(/\u200B/g, "");

        const parent = existingHighlight.parentNode;
        if (parent) {
          const frag = document.createDocumentFragment();

          if (beforeText.length > 0) {
            const beforeEl = document.createElement("code");
            beforeEl.className = highlightClasses;
            beforeEl.textContent = beforeText;
            frag.appendChild(beforeEl);
          }

          const unhighlightedNode = document.createTextNode(selectedText);
          frag.appendChild(unhighlightedNode);

          if (afterText.length > 0) {
            const afterEl = document.createElement("code");
            afterEl.className = highlightClasses;
            afterEl.textContent = afterText;
            frag.appendChild(afterEl);
          }

          parent.replaceChild(frag, existingHighlight);

          const newRange = document.createRange();
          newRange.selectNodeContents(unhighlightedNode);
          sel.removeAllRanges();
          sel.addRange(newRange);

          handleInput(true);
          pushHistorySnapshot(true);
          checkActiveFormats();
          return;
        }
      }
    }

    // CASE 1B: Non-collapsed selection spanning highlight(s) + extra spaces around them (e.g. " [text] ")
    // If all non-whitespace text in the selection is ALREADY highlighted, UNHIGHLIGHT instead of re-highlighting!
    if (!range.collapsed) {
      const cloned = range.cloneContents();
      const clonedHighlights = Array.from(cloned.querySelectorAll(".prime-highlight, mark, code")).filter(
        (el) => (el.textContent || "").replace(/\u200B/g, "").length > 0
      );

      if (clonedHighlights.length > 0) {
        let hasPlainNonWhitespace = false;
        const walker = document.createTreeWalker(cloned, NodeFilter.SHOW_TEXT);
        let tNode = walker.nextNode() as Text | null;
        while (tNode) {
          let p: Node | null = tNode.parentNode;
          let insideHl = false;
          while (p && p !== cloned) {
            if (p.nodeType === Node.ELEMENT_NODE && isHighlightNode(p as HTMLElement)) {
              insideHl = true;
              break;
            }
            p = p.parentNode;
          }
          if (!insideHl && (tNode.textContent || "").replace(/\u200B/g, "").trim().length > 0) {
            hasPlainNonWhitespace = true;
            break;
          }
          tNode = walker.nextNode() as Text | null;
        }

        if (!hasPlainNonWhitespace) {
          const extracted = range.extractContents();
          extracted.querySelectorAll(".prime-highlight, mark, code").forEach((el) => {
            const parent = el.parentNode;
            if (parent) {
              while (el.firstChild) {
                parent.insertBefore(el.firstChild, el);
              }
              el.remove();
            }
          });

          const firstNode = extracted.firstChild;
          const lastNode = extracted.lastChild;
          range.insertNode(extracted);
          cleanupEmptyHighlights();

          if (firstNode && lastNode) {
            const newRange = document.createRange();
            newRange.setStartBefore(firstNode);
            newRange.setEndAfter(lastNode);
            sel.removeAllRanges();
            sel.addRange(newRange);
          }

          handleInput(true);
          pushHistorySnapshot(true);
          checkActiveFormats();
          return;
        }
      }

      // Avoid highlighting a selection consisting purely of spaces
      if (!range.toString().replace(/\u200B/g, "").trim()) {
        return;
      }
    }

    // CASE 2: NOT inside a highlight -> APPLY
    if (range.collapsed) {
      const highlightEl = document.createElement("code");
      highlightEl.className = highlightClasses;
      const textNode = document.createTextNode("\u200B");
      highlightEl.appendChild(textNode);
      range.insertNode(highlightEl);

      const newRange = document.createRange();
      newRange.setStart(textNode, 1);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);
      handleInput(true);
      pushHistorySnapshot(true);
      checkActiveFormats();
      return;
    } else {
      const selectedContent = range.extractContents();

      // Unwrap any existing nested highlight elements inside selectedContent to prevent double-highlighting / overlapping
      const nested = selectedContent.querySelectorAll(".prime-highlight, code, mark");
      nested.forEach((el) => {
        if (!el.closest(".code-block-container") && !el.closest("pre")) {
          const parent = el.parentNode;
          if (parent) {
            while (el.firstChild) {
              parent.insertBefore(el.firstChild, el);
            }
            el.remove();
          }
        }
      });

      let highlightEl: HTMLElement = document.createElement("code");
      highlightEl.className = highlightClasses;
      highlightEl.appendChild(selectedContent);
      range.insertNode(highlightEl);
      cleanupEmptyHighlights();

      // Merge with adjacent highlight siblings if touching to form a single continuous badge
      const prev = highlightEl.previousSibling;
      if (
        prev &&
        prev.nodeType === Node.ELEMENT_NODE &&
        (prev as HTMLElement).classList.contains("prime-highlight")
      ) {
        while (highlightEl.firstChild) {
          prev.appendChild(highlightEl.firstChild);
        }
        highlightEl.remove();
        highlightEl = prev as HTMLElement;
      }

      const next = highlightEl.nextSibling;
      if (
        next &&
        next.nodeType === Node.ELEMENT_NODE &&
        (next as HTMLElement).classList.contains("prime-highlight")
      ) {
        while (next.firstChild) {
          highlightEl.appendChild(next.firstChild);
        }
        next.remove();
      }

      const newRange = document.createRange();
      newRange.selectNodeContents(highlightEl);
      sel.removeAllRanges();
      sel.addRange(newRange);
      handleInput(true);
      pushHistorySnapshot(true);
      checkActiveFormats();
      return;
    }
  };
  toggleHighlightRef.current = toggleHighlight;

  // Export handlers (.md, .txt, .pdf)
  const exportAsMarkdown = () => {
    try {
      const md = editorRef.current ? exportNotesFromEditor(editorRef.current, "md") : initialNotes;
      const header = `# ${problemExternalId ? `#${problemExternalId} - ` : ""}${problemTitle}\n\n*Exported from LeetPrime*\n\n---\n\n`;
      const fullContent = header + md;

      const blob = new Blob([fullContent], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.style.display = "none";
      const safeTitle = (problemTitle || "notes").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      a.download = `${problemExternalId ? `${problemExternalId}-` : ""}${safeTitle}-notes.md`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        if (a.parentNode) {
          a.parentNode.removeChild(a);
        }
        URL.revokeObjectURL(url);
      }, 1000);
      setIsExportOpen(false);
    } catch (err) {
      console.error("[NotesEditorModal] Export MD error:", err);
    }
  };

  const exportAsText = () => {
    try {
      const plain = editorRef.current
        ? exportNotesFromEditor(editorRef.current, "txt")
        : markdownToPlainText(initialNotes);
      const header = `${problemExternalId ? `#${problemExternalId} - ` : ""}${problemTitle}\nLeetPrime Notes\n${"-".repeat(40)}\n\n`;
      const fullContent = header + plain;

      const blob = new Blob([fullContent], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.style.display = "none";
      const safeTitle = (problemTitle || "notes").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      a.download = `${problemExternalId ? `${problemExternalId}-` : ""}${safeTitle}-notes.txt`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        if (a.parentNode) {
          a.parentNode.removeChild(a);
        }
        URL.revokeObjectURL(url);
      }, 1000);
      setIsExportOpen(false);
    } catch (err) {
      console.error("[NotesEditorModal] Export TXT error:", err);
    }
  };

  const exportAsPdf = () => {
    try {
      setIsExportOpen(false);
      const titleText = `${problemExternalId ? `#${problemExternalId} - ` : ""}${problemTitle}`;
      const editorHtml = editorRef.current
        ? exportNotesFromEditor(editorRef.current, "pdfHtml")
        : "";

      const computedStyle = editorRef.current ? window.getComputedStyle(editorRef.current) : null;
      const printFontFamily =
        computedStyle?.fontFamily ||
        "'Plus Jakarta Sans', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";
      const parsedFontSize = parseFloat(computedStyle?.fontSize || "15");
      const printFontSize = `${Math.min(16, Math.max(13, Number.isFinite(parsedFontSize) ? parsedFontSize : 15))}px`;

      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "none";
      document.body.appendChild(iframe);

      const doc = iframe.contentWindow?.document;
      if (!doc) return;

      const printHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>${titleText} - LeetPrime Notes</title>
          <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" />
          <style>
            @page {
              margin: 14mm 12mm;
              size: A4;
            }
            body {
              font-family: ${printFontFamily};
              color: #0f172a;
              background: #ffffff;
              line-height: 1.375;
              padding: 0;
              margin: 0;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .header {
              border-bottom: 2px solid #e2e8f0;
              padding-bottom: 10px;
              margin-bottom: 16px;
            }
            .header-tag {
              display: inline-block;
              font-size: 10px;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 0.05em;
              color: #7c3aed;
              background: #f5f3ff;
              border: 1px solid #ddd6fe;
              padding: 2px 8px;
              border-radius: 4px;
              margin-bottom: 6px;
            }
            h1 {
              font-size: 20px;
              font-weight: 800;
              margin: 4px 0 4px 0;
              color: #0f172a;
            }
            .meta {
              font-size: 11px;
              color: #64748b;
            }
            h2 {
              font-size: 17px;
              font-weight: 700;
              color: #1e293b;
              margin: 10px 0 4px 0;
            }
            h3 {
              font-size: 14px;
              font-weight: 600;
              color: #334155;
              margin: 6px 0 2px 0;
            }
            p {
              margin: 0;
              min-height: 1.35em;
              line-height: 1.375;
              font-size: ${printFontSize};
              color: #1e293b;
              white-space: pre-wrap;
              word-break: break-word;
            }
            ul, ol {
              padding-left: 22px;
              margin: 4px 0;
              font-size: ${printFontSize};
            }
            li {
              margin: 1px 0;
              line-height: 1.375;
              white-space: pre-wrap;
            }
            pre.pdf-diagram {
              font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
              line-height: 1.5;
              white-space: pre;
              background: #f8fafc !important;
              border: 1px solid #e2e8f0;
              border-radius: 10px;
              padding: 12px 14px;
              margin: 6px 0;
              color: #0f172a;
              overflow: hidden;
              page-break-inside: avoid;
            }
            .pdf-diagram-hl {
              display: inline-block;
              box-sizing: border-box;
              text-align: center;
              background: #fef3c7 !important;
              border: 1px solid #f59e0b !important;
              color: #92400e !important;
              border-radius: 4px;
              font-weight: 600;
              line-height: 1.28;
            }
            .code-block-container {
              border: 1px solid #e2e8f0;
              border-radius: 8px;
              background: #0f172a !important;
              color: #f8fafc !important;
              margin: 10px 0;
              overflow: hidden;
              page-break-inside: avoid;
            }
            .code-block-header {
              display: flex;
              justify-content: space-between;
              background: #1e293b !important;
              padding: 6px 12px;
              font-size: 11px;
              color: #94a3b8 !important;
              border-bottom: 1px solid #334155;
            }
            .code-block-header button, .code-delete-btn, .code-toggle-btn {
              display: none !important;
            }
            pre.code-content {
              display: block !important;
              background: #0f172a !important;
              color: #e2e8f0 !important;
              padding: 12px;
              font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
              font-size: 11.5px;
              line-height: 1.5;
              margin: 0;
              overflow-x: auto;
              white-space: pre-wrap;
            }
            pre.code-content .text-purple-400 { color: #c084fc !important; }
            pre.code-content .text-cyan-300 { color: #67e8f9 !important; }
            pre.code-content .text-amber-300 { color: #fcd34d !important; }
            pre.code-content .text-emerald-400 { color: #34d399 !important; }
            pre.code-content .text-orange-400 { color: #fb923c !important; }
            pre.code-content .text-slate-400 { color: #94a3b8 !important; font-style: italic; }

            code.prime-highlight, .prime-highlight {
              background: #fef3c7 !important;
              border: 1px solid #f59e0b !important;
              color: #92400e !important;
              padding: 2px 6px;
              margin: 0 2px;
              border-radius: 6px;
              font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
              font-size: 12px;
              font-weight: 600;
              display: inline;
            }
            u {
              text-decoration: underline;
              text-decoration-color: #f59e0b;
            }
            b, strong {
              font-weight: 700;
              color: #0f172a;
            }
            em, i {
              font-style: italic;
              color: #334155;
            }
            .footer {
              margin-top: 24px;
              border-top: 1px solid #e2e8f0;
              padding-top: 8px;
              font-size: 10px;
              color: #94a3b8;
              text-align: right;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="header-tag">LeetPrime DSA Notes</div>
            <h1>${titleText}</h1>
            <div class="meta">Exported on ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
          </div>
          <div class="content">
            ${editorHtml}
          </div>
          <div class="footer">Prepared with LeetPrime · Strategic DSA Interview Preparation</div>
        </body>
        </html>
      `;

      doc.open();
      doc.write(printHtml);
      doc.close();

      const triggerPrint = () => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        setTimeout(() => {
          if (iframe.parentNode) {
            document.body.removeChild(iframe);
          }
        }, 1200);
      };

      const fontReady = doc.fonts?.ready;
      if (fontReady) {
        Promise.race([
          fontReady,
          new Promise((resolve) => setTimeout(resolve, 900)),
        ]).then(() => setTimeout(triggerPrint, 80));
      } else {
        setTimeout(triggerPrint, 300);
      }
    } catch (err) {
      console.error("[NotesEditorModal] Export PDF error:", err);
    }
  };

  // Toggle or exit code block formatting
  const toggleCodeBlock = () => {
    if (typeof document === "undefined" || !editorRef.current) return;

    // Check if cursor is already inside a code block
    const sel = window.getSelection();
    let codeContainer: HTMLElement | null = null;
    let codeContent: HTMLElement | null = null;

    if (sel && sel.rangeCount > 0) {
      let node: Node | null = sel.getRangeAt(0).commonAncestorContainer;
      while (node && node !== editorRef.current) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement;
          if (el.classList.contains("code-block-container")) {
            codeContainer = el;
            break;
          }
          if (el.classList.contains("code-content") || el.tagName.toLowerCase() === "pre") {
            codeContent = el;
            codeContainer = el.closest(".code-block-container") as HTMLElement;
            break;
          }
        }
        node = node.parentNode;
      }
    }

    // CASE 1: Cursor is inside a code block -> User clicked <> to EXIT!
    if (codeContainer || codeContent) {
      const targetContainer = codeContainer || (codeContent?.parentElement as HTMLElement);
      if (targetContainer) {
        exitCodeBlock(targetContainer);
        return;
      }
    }

    // CASE 2: User is in normal notes -> Insert a new code block!
    pushHistorySnapshot();
    const blockHtml = createCodeBlockHtml("", "code", false);
    document.execCommand("insertHTML", false, blockHtml);
    handleInput(true);
    pushHistorySnapshot(true);
    checkActiveFormats();

    // Focus inside newly inserted code-content
    setTimeout(() => {
      if (editorRef.current) {
        const preElements = editorRef.current.querySelectorAll(".code-content");
        const lastPre = preElements[preElements.length - 1] as HTMLElement;
        if (lastPre) {
          lastPre.focus();
        }
      }
    }, 30);
  };

  // Click handler on editor to handle collapse/expand, exit clicks, and delete code button
  const handleEditorClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;

    // 1. Clicked on delete code block button (Requirement 4)
    const deleteBtn = target.closest('[data-action="delete-code"]');
    if (deleteBtn) {
      e.preventDefault();
      e.stopPropagation();
      const container = deleteBtn.closest(".code-block-container") as HTMLElement;
      if (container) {
        pushHistorySnapshot();
        let nextEl = container.nextElementSibling as HTMLElement;
        if (!nextEl || nextEl.tagName.toLowerCase() !== "p") {
          const p = document.createElement("p");
          p.innerHTML = "<br>";
          container.parentNode?.insertBefore(p, container.nextSibling);
          nextEl = p;
        }
        container.remove();
        nextEl.focus();
        handleInput(true);
        pushHistorySnapshot(true);
        checkActiveFormats();
      }
      return;
    }

    // 2. Clicked on expand button (Requirement 3)
    const expandBtn = target.closest('[data-action="expand-code"]');
    if (expandBtn) {
      e.preventDefault();
      e.stopPropagation();
      const container = expandBtn.closest(".code-block-container") as HTMLElement;
      if (container) {
        expandCodeBlock(container);
      }
      return;
    }

    // 3. Clicked on exit code button (Requirement 3)
    const exitBtn = target.closest('[data-action="exit-code"]');
    if (exitBtn) {
      e.preventDefault();
      e.stopPropagation();
      const container = exitBtn.closest(".code-block-container") as HTMLElement;
      if (container) {
        exitCodeBlock(container);
      }
      return;
    }

    // 4. Clicked on header to collapse/expand
    const header = target.closest('[data-action="toggle-collapse"]');
    if (header) {
      e.preventDefault();
      e.stopPropagation();
      const container = header.closest(".code-block-container") as HTMLElement;
      if (container) {
        toggleContainerCollapse(container);
      }
      return;
    }

    // 5. Clicked directly in empty bottom space below all elements
    if (target === editorRef.current && editorRef.current) {
      const lastChild = editorRef.current.lastElementChild;
      if (lastChild && lastChild.tagName.toLowerCase() === "p") {
        (lastChild as HTMLElement).focus();
      } else {
        const p = document.createElement("p");
        p.innerHTML = "<br>";
        editorRef.current.appendChild(p);
        p.focus();
      }
    }

    // 6. Clicked on or near the right boundary of an inline highlight badge -> land in next text node at offset 0
    const highlight = target.closest(".prime-highlight, code:not(.code-content)") as HTMLElement | null;
    if (highlight && !highlight.closest(".code-block-container") && !highlight.closest("pre")) {
      const rect = highlight.getBoundingClientRect();
      if (e.clientX >= rect.right - 8) {
        const next = highlight.nextSibling;
        if (next && next.nodeType === Node.TEXT_NODE) {
          const newRange = document.createRange();
          newRange.setStart(next, 0);
          newRange.collapse(true);
          const sel = window.getSelection();
          if (sel) {
            sel.removeAllRanges();
            sel.addRange(newRange);
          }
        }
      }
    }

    checkActiveFormats();
  };

  // Keyboard navigation inside editor: Tab for 4 spaces, Shift+Enter/Escape to exit code block
  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const sel = window.getSelection();
    let insideCode = false;
    let codeContentEl: HTMLElement | null = null;

    if (sel && sel.rangeCount > 0) {
      let node: Node | null = sel.getRangeAt(0).commonAncestorContainer;
      while (node && node !== editorRef.current) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement;
          if (el.classList.contains("code-content") || el.tagName.toLowerCase() === "pre") {
            insideCode = true;
            codeContentEl = el;
            break;
          }
        }
        node = node.parentNode;
      }
    }

    if (insideCode && codeContentEl) {
      // Tab key inside code -> indent 4 spaces
      if (e.key === "Tab") {
        e.preventDefault();
        document.execCommand("insertText", false, "    ");
        handleInput();
        return;
      }

      // Shift+Enter or Escape inside code -> Exit to notes below!
      if (e.key === "Escape" || (e.key === "Enter" && e.shiftKey)) {
        e.preventDefault();
        const container = codeContentEl.closest(".code-block-container") as HTMLElement;
        if (container) {
          exitCodeBlock(container);
        }
        return;
      }

      // Enter inside code block -> ensure clean newline and update line count
      if (e.key === "Enter") {
        setTimeout(() => {
          if (codeContentEl) {
            const container = codeContentEl.closest(".code-block-container");
            const lineCountEl = container?.querySelector(".code-line-count");
            if (lineCountEl) {
              const count = extractCodeText(codeContentEl).split("\n").length;
              lineCountEl.textContent = `${count} ${count === 1 ? "line" : "lines"}`;
            }
          }
        }, 10);
      }
      return;
    }

    // ── Boundary & Arrow Navigation for Inline Highlight Badges (prevents caret skipping) ──
    if (sel && sel.rangeCount > 0 && sel.isCollapsed) {
      const range = sel.getRangeAt(0);
      const container = range.startContainer;
      const offset = range.startOffset;

      // Find if we are currently inside or directly adjacent to a prime-highlight
      let highlightEl: HTMLElement | null = null;
      let currNode: Node | null = container;
      while (currNode && currNode !== editorRef.current) {
        if (currNode.nodeType === Node.ELEMENT_NODE) {
          const el = currNode as HTMLElement;
          if (
            el.classList.contains("prime-highlight") ||
            (el.tagName.toLowerCase() === "code" && !el.closest(".code-block-container") && !el.closest("pre"))
          ) {
            highlightEl = el;
            break;
          }
        }
        currNode = currNode.parentNode;
      }

      if (highlightEl) {
        // Cursor is INSIDE the highlight element
        const isAtEnd =
          container === highlightEl
            ? offset === highlightEl.childNodes.length
            : offset === (container.textContent?.length ?? 0);

        // Case 1: ArrowRight at the end of highlight -> move directly to offset 0 of next sibling
        if (e.key === "ArrowRight" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && isAtEnd) {
          const next = highlightEl.nextSibling;
          if (next) {
            e.preventDefault();
            const newRange = document.createRange();
            if (next.nodeType === Node.TEXT_NODE) {
              newRange.setStart(next, 0);
            } else {
              newRange.setStartBefore(next);
            }
            newRange.collapse(true);
            sel.removeAllRanges();
            sel.addRange(newRange);
            checkActiveFormats();
            return;
          } else {
            e.preventDefault();
            const emptyText = document.createTextNode("");
            highlightEl.parentNode?.appendChild(emptyText);
            const newRange = document.createRange();
            newRange.setStart(emptyText, 0);
            newRange.collapse(true);
            sel.removeAllRanges();
            sel.addRange(newRange);
            checkActiveFormats();
            return;
          }
        }

        // Case 2: Space at the end of highlight -> exit highlight and insert space outside
        if (e.key === " " && isAtEnd && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
          e.preventDefault();
          const next = highlightEl.nextSibling;
          if (next && next.nodeType === Node.TEXT_NODE) {
            const nextText = next as Text;
            nextText.insertData(0, " ");
            const newRange = document.createRange();
            newRange.setStart(nextText, 1);
            newRange.collapse(true);
            sel.removeAllRanges();
            sel.addRange(newRange);
          } else {
            const spaceText = document.createTextNode(" ");
            if (next) {
              highlightEl.parentNode?.insertBefore(spaceText, next);
            } else {
              highlightEl.parentNode?.appendChild(spaceText);
            }
            const newRange = document.createRange();
            newRange.setStart(spaceText, 1);
            newRange.collapse(true);
            sel.removeAllRanges();
            sel.addRange(newRange);
          }
          handleInput();
          checkActiveFormats();
          return;
        }
      } else {
        // Cursor is OUTSIDE highlight, check if in a text node directly following a highlight
        if (container.nodeType === Node.TEXT_NODE) {
          const prev = container.previousSibling;
          if (
            prev &&
            prev.nodeType === Node.ELEMENT_NODE &&
            ((prev as HTMLElement).classList.contains("prime-highlight") ||
              (prev as HTMLElement).tagName.toLowerCase() === "code")
          ) {
            // We are in text immediately after a highlight!
            // If at offset 1 and user presses ArrowLeft, land at offset 0 (before the first character) instead of jumping past it!
            if (e.key === "ArrowLeft" && offset === 1 && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
              e.preventDefault();
              const newRange = document.createRange();
              newRange.setStart(container, 0);
              newRange.collapse(true);
              sel.removeAllRanges();
              sel.addRange(newRange);
              checkActiveFormats();
              return;
            }
          }
        }
      }
    }
  };

  // Intelligent paste handler for code blocks and formatted text
  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;

    const sel = window.getSelection();
    let insideCode = false;
    let codeContentEl: HTMLElement | null = null;

    if (sel && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0);
      let node: Node | null = r.startContainer;
      while (node && node !== editorRef.current) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement;
          if (el.classList.contains("code-content") || el.tagName.toLowerCase() === "pre") {
            insideCode = true;
            codeContentEl = el;
            break;
          }
        }
        node = node.parentNode;
      }
    }

    // CASE 1: Inside an existing code block -> splice normalized multiline text & re-highlight cleanly
    if (insideCode && codeContentEl && sel && sel.rangeCount > 0) {
      e.preventDefault();
      pushHistorySnapshot();

      const range = sel.getRangeAt(0);
      const cleanPaste = text.replace(/\r\n|\r|\u2028|\u2029/g, "\n");

      // Delete any selected text first
      if (!range.collapsed) {
        range.deleteContents();
      }

      // Compute plain text before & after caret inside codeContentEl so browser spans/BRs never squash newlines
      const preRange = document.createRange();
      preRange.selectNodeContents(codeContentEl);
      preRange.setEnd(range.startContainer, range.startOffset);
      const beforeText = extractCodeText(preRange.cloneContents());

      const postRange = document.createRange();
      postRange.selectNodeContents(codeContentEl);
      postRange.setStart(range.startContainer, range.startOffset);
      const afterText = extractCodeText(postRange.cloneContents());

      const newFullCode = beforeText + cleanPaste + afterText;
      const container = codeContentEl.closest(".code-block-container");
      const lang = container?.getAttribute("data-lang") || "code";

      codeContentEl.innerHTML = highlightCodeHtml(newFullCode, lang);
      setCodeCaretOffset(codeContentEl, beforeText.length + cleanPaste.length);

      // Update line count in header
      const lineCountEl = container?.querySelector(".code-line-count");
      if (lineCountEl) {
        const count = newFullCode.trim() ? newFullCode.split("\n").length : 1;
        lineCountEl.textContent = `${count} ${count === 1 ? "line" : "lines"}`;
      }

      handleInput(true);
      pushHistorySnapshot(true);
      checkActiveFormats();
      return;
    }

    // CASE 2: Outside code block
    // ONLY create a code block if the text explicitly contains fenced markdown code blocks (``` ... ```)
    const trimmed = text.trim();
    if (trimmed.startsWith("```") && trimmed.endsWith("```") && trimmed.length > 6) {
      e.preventDefault();
      pushHistorySnapshot();
      const firstLineEnd = trimmed.indexOf("\n");
      let lang = "code";
      let code = "";
      if (firstLineEnd !== -1) {
        lang = trimmed.slice(3, firstLineEnd).trim() || "code";
        code = trimmed.slice(firstLineEnd + 1, trimmed.length - 3).trimEnd();
      } else {
        code = trimmed.slice(3, -3).trimEnd();
      }
      const blockHtml = createCodeBlockHtml(code, lang);
      document.execCommand("insertHTML", false, blockHtml);
      handleInput(true);
      pushHistorySnapshot(true);
      checkActiveFormats();
      return;
    }

    // CASE 3: Normal text paste (from MS Word, plain text, browser, or anywhere else)
    // NEVER forcibly convert plain text, comments (//), or equations into code blocks!
    const html = e.clipboardData.getData("text/html");
    const isOfficeHtml =
      html &&
      (html.includes("urn:schemas-microsoft-com:office") ||
        html.includes("class=\"Mso") ||
        html.includes("class='Mso") ||
        html.includes("mso-"));

    // If copied from MS Word or if it's plain text without HTML, paste clean text directly
    if (isOfficeHtml || !html) {
      e.preventDefault();
      pushHistorySnapshot();
      document.execCommand("insertText", false, text);
      handleInput(true);
      pushHistorySnapshot(true);
      checkActiveFormats();
      return;
    }
  };

  const getBtnClass = (isActive: boolean) =>
    cn(
      "p-1 sm:p-1.5 rounded-lg transition-all cursor-pointer text-xs flex items-center justify-center shrink-0",
      isActive
        ? "bg-violet-600/35 text-violet-200 border border-violet-500/50 shadow-[0_0_12px_rgba(139,92,246,0.3)]"
        : "text-zinc-400 hover:text-white hover:bg-white/10 border border-transparent"
    );

  const getHighlightBtnClass = (isActive: boolean) =>
    cn(
      "p-1 sm:p-1.5 rounded-lg transition-all cursor-pointer text-xs flex items-center justify-center shrink-0",
      isActive
        ? "bg-amber-500/20 text-amber-200 border border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.3)]"
        : "text-zinc-400 hover:text-white hover:bg-white/10 border border-transparent"
    );

  return (
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150"
      onClick={handleSaveAndClose}
    >
      {/* Dimmed backdrop */}
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" />

      {/* Fixed Comfortable Dialog */}
      <div
        className={cn(
          "relative z-10 w-full max-w-2xl h-[520px] max-h-[85vh] bg-[#0d0f1e] border border-white/10 rounded-2xl flex flex-col shadow-2xl shadow-black/80 overflow-hidden"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-white/[0.08] bg-white/[0.02]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-violet-400 shrink-0">
              <BookOpen className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-white truncate">Notes</h2>
              <p className="text-[11px] text-zinc-400 truncate max-w-[220px] sm:max-w-md">
                {problemExternalId ? `#${problemExternalId} ` : ""}
                {problemTitle}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span
              ref={saveStatusRef}
              className="text-[11px] font-medium text-emerald-400/90 hidden sm:inline"
            >
              Saved
            </span>
            <button
              onClick={handleSaveAndClose}
              type="button"
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Visual WYSIWYG Formatting Toolbar with Active Glow ── */}
        <div className="relative px-2.5 sm:px-4 py-1.5 sm:py-2 border-b border-white/[0.06] bg-white/[0.015] flex items-center justify-between gap-1.5 sm:gap-2 overflow-visible z-30">
          <div className="flex-1 min-w-0 flex items-center gap-0.5 sm:gap-1 overflow-x-auto no-scrollbar scrollbar-none py-0.5">
            {/* Headings */}
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                toggleHeading("H1");
              }}
              className={getBtnClass(activeFormats.h1)}
              title="Large Heading"
            >
              <Heading1 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>

            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                toggleHeading("H2");
              }}
              className={getBtnClass(activeFormats.h2)}
              title="Medium Heading"
            >
              <Heading2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>

            <div className="h-3.5 sm:h-4 w-px bg-white/10 mx-0.5 sm:mx-1 shrink-0" />

            {/* Prime AI Highlight Notation / Term Button */}
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                toggleHighlight();
              }}
              className={getHighlightBtnClass(activeFormats.highlight)}
              title="Highlight Notation / Term (Ctrl+H)"
            >
              <Highlighter className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>

            {/* Bold, Italic, Underline */}
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                execCmd("bold");
              }}
              className={getBtnClass(activeFormats.bold)}
              title="Bold (Ctrl+B)"
            >
              <Bold className="w-3.5 h-3.5 sm:w-4 sm:h-4 font-bold" />
            </button>

            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                execCmd("italic");
              }}
              className={getBtnClass(activeFormats.italic)}
              title="Italic (Ctrl+I)"
            >
              <Italic className="w-3.5 h-3.5 sm:w-4 sm:h-4 italic" />
            </button>

            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                execCmd("underline");
              }}
              className={getBtnClass(activeFormats.underline)}
              title="Underline (Ctrl+U)"
            >
              <Underline className="w-3.5 h-3.5 sm:w-4 sm:h-4 underline" />
            </button>

            {/* Code Block Button */}
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                toggleCodeBlock();
              }}
              className={getBtnClass(activeFormats.code)}
              title="Code Block"
            >
              <Code className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>

            <div className="h-3.5 sm:h-4 w-px bg-white/10 mx-0.5 sm:mx-1 shrink-0" />

            {/* Lists */}
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                execCmd("insertUnorderedList");
              }}
              className={getBtnClass(activeFormats.ul)}
              title="Bullet List"
            >
              <List className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>

            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                execCmd("insertOrderedList");
              }}
              className={getBtnClass(activeFormats.ol)}
              title="Numbered List"
            >
              <ListOrdered className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
          </div>

          {/* Right: Minimalist Export Dropdown */}
          <div className="relative shrink-0 ml-auto" ref={exportDropdownRef}>
            <button
              type="button"
              onClick={() => setIsExportOpen(!isExportOpen)}
              className="flex items-center gap-1 sm:gap-1.5 px-2 py-1 sm:px-2.5 sm:py-1 rounded-lg text-[11px] sm:text-xs font-medium text-zinc-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-white/20 transition-all cursor-pointer select-none shrink-0"
              title="Export or share notes"
            >
              <Download className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-amber-400" />
              <span>Export</span>
              <ChevronDown
                className={cn(
                  "w-3 h-3 text-zinc-400 transition-transform duration-150",
                  isExportOpen && "rotate-180"
                )}
              />
            </button>

            {/* Minimalist Dropdown Menu with Quick Info Hover Tooltips */}
            {isExportOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-44 rounded-xl bg-[#0d0f1e] border border-white/10 shadow-2xl p-1 z-50 animate-in fade-in zoom-in-95 duration-100">
                <button
                  type="button"
                  onClick={exportAsPdf}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-zinc-200 hover:text-white hover:bg-white/10 transition-colors text-left cursor-pointer group"
                  title="Export as PDF (.pdf) — Styled & print-ready for reading and sharing"
                >
                  <FileText className="w-3.5 h-3.5 text-rose-400 group-hover:scale-110 transition-transform shrink-0" />
                  <span className="truncate">Export as PDF (.pdf)</span>
                </button>

                <button
                  type="button"
                  onClick={exportAsMarkdown}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-zinc-200 hover:text-white hover:bg-white/10 transition-colors text-left cursor-pointer group"
                  title="Export as Markdown (.md) — For developer tools, Obsidian, Notion & personal wikis"
                >
                  <FileCode className="w-3.5 h-3.5 text-violet-400 group-hover:scale-110 transition-transform shrink-0" />
                  <span className="truncate">Export as Markdown (.md)</span>
                </button>

                <button
                  type="button"
                  onClick={exportAsText}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-zinc-200 hover:text-white hover:bg-white/10 transition-colors text-left cursor-pointer group"
                  title="Export as Plain Text (.txt) — Clean unformatted plain text notes"
                >
                  <File className="w-3.5 h-3.5 text-zinc-400 group-hover:scale-110 transition-transform shrink-0" />
                  <span className="truncate">Export as Text (.txt)</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Visual WYSIWYG Writing Area ── */}
        <div className="flex-1 p-4 sm:p-5 flex flex-col overflow-hidden">
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onInput={() => handleInput()}
            onPaste={handlePaste}
            onClick={handleEditorClick}
            onKeyDown={handleEditorKeyDown}
            onKeyUp={checkActiveFormats}
            onMouseUp={checkActiveFormats}
            data-placeholder="Add your approach, time complexity, code or insight..."
            className={cn(
              "w-full flex-1 bg-transparent text-sm sm:text-base text-zinc-100 focus:outline-none overflow-y-auto leading-snug select-text scrollbar-thin",
              // Instant Visual Formatting Styles (compact line spacing + diagram-safe whitespace)
              "[&_h1]:text-lg [&_h1]:sm:text-xl [&_h1]:font-bold [&_h1]:text-white [&_h1]:mb-1 [&_h1]:mt-1.5",
              "[&_h2]:text-base [&_h2]:sm:text-lg [&_h2]:font-semibold [&_h2]:text-white [&_h2]:mb-0.5 [&_h2]:mt-1",
              "[&_b]:font-bold [&_b]:text-white [&_strong]:font-bold [&_strong]:text-white",
              "[&_i]:italic [&_i]:text-violet-200 [&_em]:italic [&_em]:text-violet-200",
              "[&_u]:underline [&_u]:underline-offset-2 [&_u]:decoration-amber-400/80",
              "[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-0.5 [&_ul]:space-y-0",
              "[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-0.5 [&_ol]:space-y-0",
              "[&_p]:my-0 [&_p]:min-h-[1.35em] [&_p]:leading-snug [&_p]:whitespace-pre-wrap [&_p]:text-sm [&_p]:sm:text-base [&_p]:text-zinc-100",
              "[&_code]:bg-amber-400/25 [&_code]:border [&_code]:border-amber-400/50 [&_code]:text-amber-200 [&_code]:shadow-[0_0_10px_rgba(245,158,11,0.2)] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded-md [&_code]:text-[12px] [&_code]:font-mono [&_code]:font-semibold [&_code]:mx-0.5",
              // Collapsible Code Block Container Styles
              "[&_.code-block-container]:my-2 [&_.code-block-container]:rounded-xl [&_.code-block-container]:border [&_.code-block-container]:border-white/10 [&_.code-block-container]:bg-[#080914] [&_.code-block-container]:overflow-hidden [&_.code-block-container]:shadow-md",
              "[&_.code-content]:p-3 [&_.code-content]:min-h-[3.25rem] [&_.code-content]:text-xs [&_.code-content]:font-mono [&_.code-content]:text-cyan-200 [&_.code-content]:leading-relaxed [&_.code-content]:overflow-x-auto [&_.code-content]:whitespace-pre [&_.code-content]:outline-none",
              // Clean placeholder when empty
              "empty:before:content-[attr(data-placeholder)] empty:before:text-zinc-600 empty:before:pointer-events-none"
            )}
            spellCheck={false}
          />
        </div>

        {/* ── Footer ── */}
        <div className="px-4 sm:px-5 py-2.5 border-t border-white/[0.08] bg-black/30 flex items-center justify-between text-xs text-zinc-500">
          <span ref={wordCountRef}>0 words</span>

          <button
            type="button"
            onClick={handleSaveAndClose}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold transition-all cursor-pointer active:scale-95"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Done</span>
          </button>
        </div>
      </div>
    </div>
  );
}
