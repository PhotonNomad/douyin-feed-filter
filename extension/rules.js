(() => {
  if (globalThis.DouyinFeedFilterRules) return;

  // 博主 / 标签共用的小语法，手动添加时可直接写更复杂的条件：
  //   空格     同时满足（AND）
  //   | / ｜   任一满足（OR）
  //   - 前缀   排除（对整条规则生效）
  //   "..."    完全相等（引号内可带空格）
  // 不带引号的词按「包含」匹配。例：穿搭 -广告 | "每日穿搭"
  // 旧版本的 tagKeyword 规则本身就是「包含关键词」，可以直接沿用同一套解析。
  const TARGET_BY_KIND = {
    authorKeyword: "author",
    tagKeyword: "tag"
  };
  const QUOTE_PAIRS = { '"': '"', "'": "'", "“": "”", "「": "」", "『": "』" };
  const OR_CHARS = new Set(["|", "｜"]);
  const NOT_PREFIXES = new Set(["-"]);

  function normalize(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  // 解析成「或」连接的若干正向分支；带 - 的排除项单独收集，对整条规则生效。
  // 返回 null 表示写法无效（空分支、引号未闭合、只有排除项等）。
  function parseExpression(value) {
    const text = String(value || "").trim();
    if (!text) return null;

    const branches = [];
    const excludes = [];
    let positives = [];
    let negatives = [];
    let index = 0;

    const endBranch = () => {
      if (!positives.length) return false;
      branches.push(positives);
      excludes.push(...negatives);
      positives = [];
      negatives = [];
      return true;
    };

    while (index < text.length) {
      const char = text[index];

      if (/\s/.test(char)) {
        index += 1;
        continue;
      }

      if (OR_CHARS.has(char)) {
        if (!endBranch()) return null;
        index += 1;
        continue;
      }

      let negate = false;
      if (
        NOT_PREFIXES.has(char) &&
        index + 1 < text.length &&
        !/\s/.test(text[index + 1])
      ) {
        negate = true;
        index += 1;
      }

      let term = "";
      let quoted = false;
      const closing = QUOTE_PAIRS[text[index]];

      if (closing) {
        quoted = true;
        index += 1;
        const start = index;
        while (index < text.length && text[index] !== closing) index += 1;
        if (index >= text.length) return null;
        term = text.slice(start, index);
        index += 1;
        if (index < text.length && !/\s/.test(text[index]) && !OR_CHARS.has(text[index])) {
          return null;
        }
      } else {
        const start = index;
        while (index < text.length && !/\s/.test(text[index]) && !OR_CHARS.has(text[index])) {
          index += 1;
        }
        term = text.slice(start, index);
      }

      term = normalize(term);
      if (!term) return null;
      (negate ? negatives : positives).push({ text: term, quoted });
    }

    if (!endBranch()) return null;
    return { branches, excludes };
  }

  function cleanTerm(term, target) {
    let text = term.text;

    // 复制标签/昵称时常见的前导 # / @ 直接忽略，两种写法都支持。
    if (target === "tag") text = text.replace(/^#+/, "");
    else if (target === "author") text = text.replace(/^@+/, "");

    // 只有不加引号的词才清理粘贴带来的尾部标点；引号内保持原样。
    if (!term.quoted) text = text.replace(/[，。！？.,!?]+$/, "");
    return text.trim();
  }

  function compileRule(rule) {
    const target = TARGET_BY_KIND[rule?.kind];
    if (!target) return null;

    const parsed = parseExpression(rule.value);
    if (!parsed) return null;

    const compileTerms = (terms) => {
      const compiled = [];
      for (const term of terms) {
        const text = cleanTerm(term, target);
        if (!text) return null;
        compiled.push({ text, quoted: term.quoted });
      }
      return compiled;
    };

    const branches = [];
    for (const branch of parsed.branches) {
      const terms = compileTerms(branch);
      if (!terms) return null;
      branches.push(terms);
    }

    const excludes = compileTerms(parsed.excludes);
    if (!excludes) return null;

    return { rule, target, branches, excludes };
  }

  function compileRules(blocked) {
    const compiled = { author: [], tag: [] };
    if (!blocked || typeof blocked !== "object") return compiled;

    for (const rule of Object.values(blocked)) {
      const item = compileRule(rule);
      if (item) compiled[item.target].push(item);
    }

    return compiled;
  }

  function fieldsFor(target, entry) {
    if (target === "author") {
      return [entry?.author, entry?.authorId].map(normalize).filter(Boolean);
    }
    return (Array.isArray(entry?.tags) ? entry.tags : [])
      .map((tag) => normalize(String(tag || "").replace(/^#+/, "")))
      .filter(Boolean);
  }

  function termMatches(fields, term) {
    return fields.some((field) =>
      term.quoted ? field === term.text : field.includes(term.text)
    );
  }

  function branchMatches(fields, branch) {
    return branch.every((term) => termMatches(fields, term));
  }

  function matchCompiled(compiled, entry) {
    if (!compiled || !entry) return null;

    // 博主规则优先，和原来的匹配顺序一致。
    for (const target of ["author", "tag"]) {
      const items = compiled[target];
      if (!items?.length) continue;

      const fields = fieldsFor(target, entry);
      if (!fields.length) continue;

      for (const item of items) {
        if (!item.branches.some((branch) => branchMatches(fields, branch))) continue;
        if (item.excludes.some((term) => termMatches(fields, term))) continue;
        return item.rule;
      }
    }

    return null;
  }

  // 把编译后的条件重新拼成稳定的键：同一规则的不同写法（大小写、空格、
  // 引号风格、# / @ 前缀、排除项的位置）会得到同一个键，避免手动添加出重复项。
  function canonicalKey(compiled) {
    const formatTerm = (term) => (term.quoted ? `"${term.text}"` : term.text);
    const positive = compiled.branches
      .map((branch) => branch.map(formatTerm).join(" "))
      .join("|");
    const negative = compiled.excludes.map((term) => `-${formatTerm(term)}`).join(" ");
    return [positive, negative].filter(Boolean).join(" ");
  }

  function buildExpressionRule(kind, value) {
    if (kind !== "author" && kind !== "tag") return null;

    const text = String(value || "").trim();
    if (!text) return null;

    const expressionKind = `${kind}Keyword`;
    const rule = {
      key: "",
      kind: expressionKind,
      value: text,
      label: `${kind === "author" ? "博主" : "标签"}匹配 ${text}`
    };

    // 用与匹配时同一套解析和清理来校验。
    const compiled = compileRule(rule);
    if (!compiled) return null;

    rule.key = `${expressionKind}:${canonicalKey(compiled)}`;
    return rule;
  }

  globalThis.DouyinFeedFilterRules = {
    normalize,
    parseExpression,
    compileRules,
    matchCompiled,
    buildExpressionRule
  };
})();
