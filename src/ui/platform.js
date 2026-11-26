'use strict';
{
  const bridge = window.maxweb || window.maxwebShell || {};
  const isWindows = bridge.platform === 'win32';
  window.oblaPlatform = { isWindows, system: isWindows ? 'Windows' : 'macOS', modifier: isWindows ? 'Ctrl+' : '⌘' };
  if (isWindows) {
    const replace = text => text.replaceAll('ДЛЯ INTEL И APPLE SILICON', 'ДЛЯ WINDOWS')
      .replaceAll('Intel · Apple Silicon', 'Windows x64').replaceAll('Код и Touch ID', 'Код доступа')
      .replaceAll('macOS', 'Windows').replaceAll('Mac', 'Windows').replaceAll('⌘', 'Ctrl+')
      .replaceAll('строки меню или Dock', 'значка в области уведомлений');
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) walker.currentNode.textContent = replace(walker.currentNode.textContent);
    for (const element of document.querySelectorAll('[title]')) element.title = replace(element.title);
  }
}
