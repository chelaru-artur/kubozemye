// Запускает тесты и кладёт в dist/release.json данные для страницы проверки релиза.
// Упавшие тесты останавливают публикацию.
import { execSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const git = (args) => execSync(`git ${args}`, { encoding: 'utf8' }).trim();

const run = spawnSync('node', ['--test', '--test-reporter=tap'], { encoding: 'utf8' });
const metric = (name) => Number(run.stdout.match(new RegExp(`^# ${name} (\\d+)$`, 'm'))?.[1] ?? 0);
const tests = { total: metric('tests'), pass: metric('pass'), fail: metric('fail') };

const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_RUN_NUMBER } = process.env;
writeFileSync('dist/release.json', JSON.stringify({
  commit: git('rev-parse HEAD'),
  message: git('log -1 --format=%s'),
  committedAt: git('log -1 --format=%cI'),
  builtAt: new Date().toISOString(),
  runNumber: GITHUB_RUN_NUMBER ?? null,
  runUrl: GITHUB_RUN_ID ? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}` : null,
  tests,
}, null, 2));

console.log(`Тесты: ${tests.pass} из ${tests.total}`);
if (run.status !== 0 || tests.total === 0) {
  console.error(run.stdout);
  process.exit(1);
}
