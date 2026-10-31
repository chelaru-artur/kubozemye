import { defineConfig } from 'vite';

// Складывает скрипт и стили внутрь index.html: игра публикуется одним файлом.
function singleFile() {
  return {
    name: 'single-file',
    enforce: 'post',
    generateBundle(_, bundle) {
      const html = bundle['index.html'];
      const js = Object.values(bundle).find((f) => f.type === 'chunk');
      const css = Object.values(bundle).find((f) => f.fileName.endsWith('.css'));
      html.source = html.source
        .replace(/<script type="module"[^>]*><\/script>\s*/, '')
        .replace(/<link rel="stylesheet" crossorigin[^>]*>/, () => `<style>${css.source}</style>`)
        .replace('</body>', () => `<script type="module">${js.code.replaceAll('</script', '<\\/script')}</script>\n</body>`);
      delete bundle[js.fileName];
      delete bundle[css.fileName];
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [singleFile()],
});
