'use strict';

// The repository keeps the changelog; update prompts contain one release only.
function releaseNotes(markdown, version) {
  const headings = [...markdown.matchAll(/^#{1,6}[ \t]+Maxweb[ \t]+v?(\d+\.\d+\.\d+)[ \t]*#*[ \t]*\r?$/gm)];
  const index = headings.findIndex(heading => heading[1] === version);
  if (index === -1) throw new Error(`Нет описания выпуска ${version} в RELEASE_NOTES.md.`);
  const start = headings[index].index + headings[index][0].length;
  const end = headings[index + 1]?.index ?? markdown.length;
  const notes = markdown.slice(start, end).trim();
  if (!notes) throw new Error(`Пустое описание выпуска ${version}.`);
  return notes;
}

module.exports = { releaseNotes };
