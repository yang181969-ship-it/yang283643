import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_API_URL = 'https://comment.yang181969.com/api/comments';
const DEFAULT_OUTPUT_PATH = './data/comments-stats.json';
const PAGE_SIZE = 50;
const MAX_PAGES = 1000;
const REQUEST_TIMEOUT_MS = 12_000;

const apiUrl = process.env.COMMENT_STATS_API_URL || DEFAULT_API_URL;
const outputPath = path.resolve(process.env.COMMENT_STATS_OUTPUT_PATH || DEFAULT_OUTPUT_PATH);
const outputDir = path.dirname(outputPath);
const tempPath = path.join(
  outputDir,
  `.${path.basename(outputPath)}.${process.pid}.${Date.now()}.tmp`
);

function asObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  return value;
}

function asArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`);
  return value;
}

function asNonNegativeNumber(value, label, fallback = null) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== null) return fallback;
    throw new Error(`${label} 缺失`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} 必须是非负数字`);
  return number;
}

function asPositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${label} 必须是正整数`);
  return number;
}

function buildPageUrl(page) {
  const url = new URL(apiUrl);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('COMMENT_STATS_API_URL 只支持 http 或 https');
  }
  if (url.protocol === 'https:' && process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    throw new Error('检测到 NODE_TLS_REJECT_UNAUTHORIZED=0;为保证 TLS 安全已拒绝请求');
  }
  url.searchParams.set('page', String(page));
  url.searchParams.set('pageSize', String(PAGE_SIZE));
  return url;
}

async function fetchPage(page) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(buildPageUrl(page), {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`公开留言 API 返回 HTTP ${response.status}`);

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error('公开留言 API 返回的内容不是有效 JSON');
    }

    const data = asObject(asObject(payload, '响应').data, '响应 data');
    const comments = asArray(data.comments, 'data.comments');
    const pagination = asObject(data.pagination, 'data.pagination');
    const totalPages = asPositiveInteger(pagination.totalPages, 'pagination.totalPages');
    if (totalPages > MAX_PAGES) {
      throw new Error(`pagination.totalPages 超过安全上限 ${MAX_PAGES}`);
    }

    const stats = data.stats === undefined ? null : asObject(data.stats, 'data.stats');
    return { comments, totalPages, stats };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`公开留言 API 请求超时(${REQUEST_TIMEOUT_MS / 1000} 秒)`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function recordRole(record) {
  const adminFlag = record?.is_admin === true
    || record?.is_admin === 1
    || ['true', '1'].includes(String(record?.is_admin || '').trim().toLowerCase());
  if (adminFlag || String(record?.role || '').trim().toLowerCase() === 'admin') {
    return 'admin';
  }
  if (String(record?.role || '').trim().toLowerCase() === 'guest') return 'guest';
  return null;
}

function aggregateRecords(topLevelComments) {
  let topLevel = 0;
  let replies = 0;
  let likes = 0;
  let guest = 0;
  let admin = 0;

  const visit = (record, isTopLevel) => {
    asObject(record, isTopLevel ? '顶级留言' : '回复');
    if (isTopLevel) topLevel += 1;
    else replies += 1;

    likes += asNonNegativeNumber(record.likes, '记录 likes', 0);
    const role = recordRole(record);
    if (role === 'guest') guest += 1;
    if (role === 'admin') admin += 1;

    const childReplies = record.replies === undefined
      ? []
      : asArray(record.replies, '记录 replies');
    childReplies.forEach(reply => visit(reply, false));
  };

  topLevelComments.forEach(comment => visit(comment, true));
  return { total: topLevel + replies, topLevel, replies, likes, guest, admin };
}

function warnIfStatsDiffer(apiStats, aggregate) {
  if (!apiStats) return;
  const comparisons = [
    ['total', aggregate.total],
    ['replies', aggregate.replies],
    ['likes', aggregate.likes],
  ];
  comparisons.forEach(([key, actual]) => {
    if (apiStats[key] === undefined) return;
    const reported = asNonNegativeNumber(apiStats[key], `data.stats.${key}`);
    if (reported !== actual) {
      console.warn(`⚠ API stats.${key} 与分页遍历结果不一致;已使用遍历结果`);
    }
  });
}

function buildOutput(aggregate, today) {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    summary: {
      total: aggregate.total,
      topLevel: aggregate.topLevel,
      replies: aggregate.replies,
      likes: aggregate.likes,
      today,
    },
    roles: {
      guest: aggregate.guest,
      admin: aggregate.admin,
    },
    groups: [
      {
        id: 'overview',
        name: '留言概况',
        unit: '条',
        items: [
          { name: '顶级留言', value: aggregate.topLevel },
          { name: '回复', value: aggregate.replies },
          { name: '点赞', value: aggregate.likes },
          { name: '今日留言', value: today },
        ],
      },
      {
        id: 'roles',
        name: '身份分布',
        unit: '条',
        items: [
          { name: '访客', value: aggregate.guest },
          { name: '站长', value: aggregate.admin },
        ],
      },
    ],
  };
}

async function writeAtomically(data) {
  await fs.mkdir(outputDir, { recursive: true });
  const serialized = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(tempPath, serialized, { encoding: 'utf8', flag: 'wx' });

  const parsed = JSON.parse(await fs.readFile(tempPath, 'utf8'));
  if (!parsed?.summary || !parsed?.roles || !Array.isArray(parsed?.groups)) {
    throw new Error('临时统计文件校验失败');
  }
  await fs.rename(tempPath, outputPath);
}

async function main() {
  console.log('▶ 同步公开留言聚合统计 ──────────────');
  const firstPage = await fetchPage(1);
  const allComments = [...firstPage.comments];

  for (let page = 2; page <= firstPage.totalPages; page += 1) {
    const result = await fetchPage(page);
    if (result.totalPages !== firstPage.totalPages) {
      console.warn('⚠ API 分页总页数在同步期间发生变化;按第一页页数继续');
    }
    allComments.push(...result.comments);
  }

  const aggregate = aggregateRecords(allComments);
  warnIfStatsDiffer(firstPage.stats, aggregate);
  const today = firstPage.stats?.today === undefined
    ? 0
    : asNonNegativeNumber(firstPage.stats.today, 'data.stats.today');
  const output = buildOutput(aggregate, today);
  await writeAtomically(output);

  console.log(`✓ 已同步 ${firstPage.totalPages} 页公开留言统计`);
  console.log(`  总计:${aggregate.total}  顶级:${aggregate.topLevel}  回复:${aggregate.replies}  点赞:${aggregate.likes}`);
  console.log(`  访客:${aggregate.guest}  站长:${aggregate.admin}  今日:${today}`);
  console.log(`✓ 已安全写入 ${outputPath}`);
}

try {
  await main();
} catch (error) {
  console.error(`✗ 留言统计同步失败:${error?.message || '未知错误'}`);
  process.exitCode = 1;
} finally {
  await fs.rm(tempPath, { force: true }).catch(() => {});
}
