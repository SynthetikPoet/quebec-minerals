export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/**
 * Поля SIGÉOM содержат HTML-ссылки вида <a href="…">текст</a>.
 * Не вставляем этот HTML как есть: вытаскиваем href и текст и собираем безопасную ссылку.
 */
export function linkify(value: string): string {
  const re = /<a\s+href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
  let out = '';
  let last = 0;
  for (const m of value.matchAll(re)) {
    out += esc(value.slice(last, m.index));
    const href = m[1];
    const text = m[2].replace(/<[^>]+>/g, '');
    out += /^https?:\/\//.test(href)
      ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>`
      : esc(text);
    last = m.index! + m[0].length;
  }
  return out + esc(value.slice(last));
}
