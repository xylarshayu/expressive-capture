const IMAGE_PATTERN = /!\[([^\]]*)\]\((?:<)?([^\s)>]+)(?:>)?\)/g;

export function titleFromMarkdown(markdown: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || "Untitled capture";
}

export function windowsPathToFileUrl(path: string): string {
  if (/^(https?:|data:|file:)/i.test(path)) return path;
  if (/^[A-Za-z]:[\\/]/.test(path)) return `file:///${path.replace(/\\/g, "/")}`;
  return path;
}

export function imageReferences(markdown: string): Array<{ alt: string; path: string }> {
  return [...markdown.matchAll(IMAGE_PATTERN)].map((match) => ({
    alt: match[1] || "Pasted image",
    path: match[2],
  }));
}

export function imageMarkdown(path: string, alt = "Pasted image"): string {
  return `![${alt}](${path})`;
}

export function hasAttachmentReferences(markdown: string): boolean {
  return /(?:\]\(|(?:source|preview):\s*)(?:\.\/)?attachments\//.test(markdown);
}
