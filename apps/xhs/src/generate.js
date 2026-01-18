const fs = require("node:fs");
const path = require("node:path");

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatDate(now) {
  return `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
}

function formatTimestamp(now) {
  return `${formatDate(now)}_${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
}

function slugify(input) {
  return String(input)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24) || "post";
}

function charLen(text) {
  return Array.from(String(text)).length;
}

function loadState(statePath) {
  try {
    const raw = fs.readFileSync(statePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {}
  return { index: 0, imageIndex: 0 };
}

function saveState(statePath, state) {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function listImageFiles(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => /\.(png|jpe?g|webp)$/i.test(name))
    .sort((a, b) => a.localeCompare(b));
  return files.map((name) => path.join(dirPath, name));
}

function parseCsvList(raw) {
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function pickImages({ projectDir, state, imagesCsv, imagesDir, imageCount }) {
  const explicit = parseCsvList(imagesCsv).map((p) => path.resolve(projectDir, p));
  if (explicit.length) return { images: explicit, nextImageIndex: state.imageIndex ?? 0 };

  if (!imagesDir) return { images: [], nextImageIndex: state.imageIndex ?? 0 };
  const absDir = path.resolve(projectDir, imagesDir);
  if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) {
    return { images: [], nextImageIndex: state.imageIndex ?? 0 };
  }

  const files = listImageFiles(absDir);
  if (!files.length) return { images: [], nextImageIndex: state.imageIndex ?? 0 };

  const count = Math.max(1, Math.min(9, Number(imageCount) || 1));
  const start = Number.isFinite(Number(state.imageIndex)) ? Number(state.imageIndex) : 0;
  const chosen = [];
  for (let i = 0; i < count; i += 1) {
    chosen.push(files[(start + i) % files.length]);
  }
  return { images: chosen, nextImageIndex: (start + count) % files.length };
}

function renderFrontmatter({ title, images, type }) {
  const lines = ["---", "xhs:"];
  lines.push(`  title: "${String(title).replace(/"/g, '\\"')}"`);
  if (images && images.length) {
    lines.push("  images:");
    for (const img of images) {
      lines.push(`    - "${String(img).replace(/"/g, '\\"')}"`);
    }
  }
  lines.push(`  type: ${type === "article" ? "article" : "imgNote"}`);
  lines.push("---");
  return `${lines.join("\n")}\n`;
}

const topics = [
  {
    title: "Java里==和equals到底差在哪？",
    body:
      "==默认比引用，equals通常比内容。重写equals时要同时重写hashCode，否则HashMap/HashSet可能“找不到”。建议用Objects.equals避免NPE。#Java #面试",
  },
  {
    title: "HashMap为啥会变慢？看扩容与负载因子",
    body:
      "HashMap装载过高会触发扩容：重算hash并搬迁桶，瞬时开销大。默认负载因子0.75是空间/性能折中。大量put前先估容量，减少扩容次数。#Java #集合",
  },
  {
    title: "BigDecimal别用equals比大小",
    body:
      "BigDecimal的equals会比较数值+精度：1.0和1.00不相等。业务判断大小/相等用compareTo：compareTo==0才算数值相等。金额计算也尽量统一scale。#Java",
  },
  {
    title: "try-with-resources：关闭资源更稳",
    body:
      "实现AutoCloseable的资源放进try()里，作用域结束自动close，异常链也更清晰。写IO/连接池代码别手写finally关资源，少漏关、少双关。#Java #最佳实践",
  },
  {
    title: "volatile能解决什么问题？",
    body:
      "volatile保证可见性与禁止重排序，但不保证复合操作原子性（如count++）。适合状态标记、单例双检中的引用。计数请用Atomic类或锁，别指望volatile“加锁”。#Java #并发",
  },
  {
    title: "ThreadLocal好用但也很坑",
    body:
      "ThreadLocal适合存线程上下文，但在线程池里线程复用，忘记remove会导致“串数据”或内存泄漏。用完务必remove，或在过滤器/拦截器统一清理。#Java",
  },
  {
    title: "synchronized和ReentrantLock怎么选？",
    body:
      "synchronized语法简单，JVM优化成熟；ReentrantLock支持可中断、超时、条件队列与公平锁。需要更细粒度控制再用Lock，否则先用synchronized。#Java #并发",
  },
  {
    title: "JVM内存里：堆、栈、方法区各放啥？",
    body:
      "堆放对象实例；虚拟机栈放方法栈帧（局部变量、操作数栈）；方法区存类元数据与常量。定位OOM先分清是哪块：堆溢出、栈溢出、元空间溢出。常用工具是jmap/jstack配合日志。#Java",
  },
];

function pickTopicByInput(input, stateIndex) {
  if (!input) return topics[stateIndex % topics.length];
  const normalized = String(input).trim();
  const asIndex = Number.parseInt(normalized, 10);
  if (Number.isFinite(asIndex)) {
    const idx = Math.max(0, asIndex) % topics.length;
    return topics[idx];
  }
  const lower = normalized.toLowerCase();
  return topics.find((t) => t.title.toLowerCase().includes(lower) || t.body.toLowerCase().includes(lower)) ||
    topics[stateIndex % topics.length];
}

const articles = [
  {
    title: "Java 并发入门：volatile、synchronized、Atomic 怎么选？",
    body:
      [
        "很多同学写并发代码时，第一反应是“加个 volatile 就好了”。但 volatile、synchronized、Atomic 解决的是不同层面的问题：可见性、互斥、原子性、以及更高层的并发工具。",
        "",
        "一、先用一句话分清三者",
        "- volatile：保证可见性 + 禁止重排序，不保证复合操作原子性",
        "- synchronized：互斥 + 可见性（进入/退出临界区都有内存语义），写法简单",
        "- Atomic：基于 CAS 的原子更新，适合计数、状态机等无锁场景",
        "",
        "二、volatile 适合的 3 类场景",
        "1) 状态标记：比如 stopFlag、initialized，一处写多处读",
        "2) 单例双检：volatile 用来防止对象引用发布时重排序",
        "3) 配置热更新：读多写少，写入后希望别的线程立刻看到",
        "",
        "注意：count++ 不是原子操作，volatile 也救不了。要么用 AtomicInteger，要么用锁。",
        "",
        "三、synchronized 什么时候最合适",
        "当你要保护的是“一段逻辑”而不是“一个数值更新”，synchronized 往往是最省心、最不容易出错的选择。",
        "比如：校验-修改-写回（check-then-act）、跨多个字段的一致性维护、需要等待/通知（wait/notify）等。",
        "",
        "四、Atomic 的典型用法",
        "AtomicInteger/LongAdder：高并发计数",
        "AtomicReference：无锁更新引用（比如状态机）",
        "原子类适合“短小的、可 CAS 化”的更新：不要把复杂业务硬塞进 CAS 循环。",
        "",
        "五、实战建议（非常关键）",
        "- 先保证正确，再考虑性能：能用 synchronized 写对，就别急着无锁",
        "- 避免过度共享：能局部化的数据就别放全局",
        "- 优先用更高层并发工具：Executor、BlockingQueue、Semaphore、CountDownLatch",
        "",
        "最后一句：并发里最贵的不是锁，是“你以为它没问题”。写完记得压测 + 打开线程分析工具看瓶颈。",
        "#Java #并发 #后端",
      ].join("\n"),
  },
  {
    title: "HashMap 真的懂了吗？从 put 到扩容的关键细节",
    body:
      [
        "HashMap 是最常用的集合之一，但很多性能问题都和它有关：比如突然变慢、CPU 飙升、或者在某些极端数据下退化。",
        "",
        "一、HashMap 的核心是“数组 + 链表/红黑树”",
        "数组（桶）定位靠 (n - 1) & hash，桶里元素冲突后串起来。",
        "当链表太长，会树化（条件满足时），用红黑树降低查找复杂度。",
        "",
        "二、为什么要有负载因子 0.75？",
        "装得越满，冲突越多，查找越慢；装得越空，内存浪费越大。",
        "0.75 是时间与空间的折中，且扩容成本不低：会把所有节点重新分布到新表里。",
        "",
        "三、扩容发生了什么？",
        "- 容量翻倍",
        "- 每个桶里的节点根据 hash 的某一位决定留在原位还是移动到 oldIndex + oldCap",
        "- 迁移过程中会产生明显 CPU/GC 压力",
        "",
        "四、真实项目里怎么避免 HashMap 扩容抖动",
        "1) 能预估容量就提前指定：new HashMap<>(expectedSize / 0.75f + 1)",
        "2) 批量导入时，优先一次性分配足够容量",
        "3) 热路径上尽量减少临时 HashMap 的创建（可复用或改为数组/对象字段）",
        "",
        "五、别踩的坑",
        "- key 的 equals/hashCode 必须一致：重写 equals 必须重写 hashCode",
        "- 不要用可变对象做 key（内容变了，hash 变了，就找不到）",
        "",
        "如果你想快速定位 HashMap 导致的性能问题：看分配热点、看 GC、看扩容次数，通常很快就能对上。",
        "#Java #集合 #性能优化",
      ].join("\n"),
  },
];

function pickArticleByInput(input, stateIndex) {
  if (!input) return articles[stateIndex % articles.length];
  const normalized = String(input).trim();
  const asIndex = Number.parseInt(normalized, 10);
  if (Number.isFinite(asIndex)) {
    const idx = Math.max(0, asIndex) % articles.length;
    return articles[idx];
  }
  const lower = normalized.toLowerCase();
  return articles.find((t) => t.title.toLowerCase().includes(lower) || t.body.toLowerCase().includes(lower)) ||
    articles[stateIndex % articles.length];
}

function main() {
  const projectDir = path.resolve(getArg("--project-dir") || process.cwd());
  const topicInput = getArg("--topic");
  const printPathOnly = hasFlag("--print-path");
  const noImages = hasFlag("--no-images") || getArg("--no-images") === "true";
  const mode = (getArg("--mode") || "imgNote").trim();
  const imagesDir = getArg("--images-dir") || (mode === "article" ? "" : "xhs_images");
  const imagesCsv = getArg("--images");
  const imageCount = getArg("--image-count") || "1";

  const statePath = path.join(projectDir, ".xhs_state.json");
  const state = loadState(statePath);
  const index = Number.isFinite(Number(state.index)) ? Number(state.index) : 0;

  const topic = mode === "article" ? pickArticleByInput(topicInput, index) : pickTopicByInput(topicInput, index);
  const totalCount = mode === "article" ? articles.length : topics.length;
  const nextIndex = (index + 1) % totalCount;
  const picked = noImages ? { images: [], nextImageIndex: state.imageIndex ?? 0 } : pickImages({ projectDir, state, imagesCsv, imagesDir, imageCount });
  saveState(statePath, { index: nextIndex, imageIndex: picked.nextImageIndex });

  const title = topic.title;
  const content = topic.body;
  const total = charLen(`${title}\n${content}`);
  if (mode === "article") {
    if (total < 500) process.stderr.write(`生成内容长度偏短: ${total}\n`);
  } else {
    if (total < 100 || total > 220) {
      process.stderr.write(`生成内容长度不在预期范围: ${total}\n`);
    }
  }

  const now = new Date();
  const date = formatDate(now);
  const ts = formatTimestamp(now);
  const outDir = path.join(projectDir, "posts", "xhs", date);
  fs.mkdirSync(outDir, { recursive: true });

  const filename = `${ts}_${slugify(title)}.md`;
  const outPath = path.join(outDir, filename);
  const frontmatter = renderFrontmatter({ title, images: picked.images, type: mode });
  const fileBody = `${frontmatter}# ${title}\n\n${content}\n`;
  fs.writeFileSync(outPath, fileBody, "utf8");

  if (printPathOnly) {
    process.stdout.write(outPath);
    return;
  }

  process.stdout.write(`已生成: ${outPath}\n`);
  process.stdout.write(fileBody);
}

main();
