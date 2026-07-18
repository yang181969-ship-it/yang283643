import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';

const projectRoot = path.resolve(import.meta.dirname, '..');
const tempDir = path.join(projectRoot, `.tmp-comment-stats-test-${process.pid}`);
const outputPath = path.join(tempDir, 'comments-stats.json');
const requestedPages = [];
let failRequests = false;

const pages = {
  1: [
    {
      role: 'guest',
      likes: 2,
      content: 'fake top-level text that must never be persisted',
      replies: [
        { role: 'guest', likes: 1, content: 'fake guest reply' },
      ],
    },
  ],
  2: [
    {
      role: 'guest',
      likes: 3,
      content: 'another fake top-level text',
      replies: [
        { role: 'guest', is_admin: true, likes: 4, content: 'fake admin reply' },
      ],
    },
  ],
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function runSync(apiUrl) {
  const isWindows = process.platform === 'win32';
  const command = isWindows ? (process.env.ComSpec || 'cmd.exe') : 'npm';
  const args = isWindows
    ? ['/d', '/s', '/c', 'npm.cmd run stats:comments']
    : ['run', 'stats:comments'];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: {
        ...process.env,
        COMMENT_STATS_API_URL: apiUrl,
        COMMENT_STATS_OUTPUT_PATH: outputPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

const server = http.createServer((request, response) => {
  if (failRequests) {
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'temporary failure' }));
    return;
  }

  const url = new URL(request.url, 'http://127.0.0.1');
  const page = Number(url.searchParams.get('page'));
  requestedPages.push(page);
  assert(url.searchParams.get('pageSize') === '50', '同步未使用 pageSize=50');
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({
    data: {
      comments: pages[page] || [],
      pagination: { totalPages: 2 },
      stats: { total: 4, replies: 2, likes: 10, today: 2 },
    },
  }));
});

try {
  await fs.mkdir(tempDir, { recursive: false });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const apiUrl = `http://127.0.0.1:${address.port}/api/comments`;

  const success = await runSync(apiUrl);
  assert(success.code === 0, `模拟同步应成功,实际退出码 ${success.code}: ${success.stderr}`);
  assert(requestedPages.join(',') === '1,2', `分页请求不正确:${requestedPages.join(',')}`);

  const serialized = await fs.readFile(outputPath, 'utf8');
  const output = JSON.parse(serialized);
  const expected = {
    total: 4,
    topLevel: 2,
    replies: 2,
    likes: 10,
    today: 2,
    guest: 3,
    admin: 1,
  };
  const actual = { ...output.summary, ...output.roles };
  assert(JSON.stringify(actual) === JSON.stringify(expected), `聚合值不匹配:${JSON.stringify(actual)}`);
  assert(!/fake|content|email|website|voter_id|reply_to_name/i.test(serialized), '输出包含原始留言或隐私字段');

  const replacement = await runSync(apiUrl);
  assert(replacement.code === 0, `已有文件的原子替换应成功,实际退出码 ${replacement.code}`);
  assert(requestedPages.join(',') === '1,2,1,2', `重复同步分页请求不正确:${requestedPages.join(',')}`);
  const beforeFailure = await fs.readFile(outputPath, 'utf8');
  const beforeFailureHash = sha256(beforeFailure);
  failRequests = true;
  const failure = await runSync(apiUrl);
  assert(failure.code !== 0, 'HTTP 失败时同步脚本必须非零退出');
  const afterFailure = await fs.readFile(outputPath, 'utf8');
  assert(sha256(afterFailure) === beforeFailureHash, '同步失败覆盖了有效统计文件');
  const leftovers = (await fs.readdir(tempDir)).filter(name => name.endsWith('.tmp'));
  assert(leftovers.length === 0, `残留临时文件:${leftovers.join(',')}`);

  console.log(`✓ 模拟值 预期=${JSON.stringify(expected)} 实际=${JSON.stringify(actual)}`);
  console.log(`✓ 分页请求=${requestedPages.join(',')} pageSize=50,已有文件可原子替换`);
  console.log(`✓ 失败保护 退出码=${failure.code} 哈希保持=${beforeFailureHash}`);
  console.log('✓ 输出未包含原始留言或隐私字段,且无临时文件残留');
} finally {
  await new Promise(resolve => server.close(resolve));
  const resolvedTemp = path.resolve(tempDir);
  assert(resolvedTemp.startsWith(`${projectRoot}${path.sep}`), '拒绝清理项目外路径');
  await fs.rm(resolvedTemp, { recursive: true, force: true });
}
