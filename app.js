"use strict";

const ui = {
  title: document.querySelector("#game-title"),
  theme: document.querySelector("#theme"),
  error: document.querySelector("#error"),
  nodeType: document.querySelector("#node-type"),
  progress: document.querySelector("#progress"),
  nodeTitle: document.querySelector("#node-title"),
  nodeText: document.querySelector("#node-text"),
  echoSection: document.querySelector("#echo-section"),
  echoList: document.querySelector("#echo-list"),
  clueSection: document.querySelector("#clue-section"),
  clueList: document.querySelector("#clue-list"),
  factSection: document.querySelector("#fact-section"),
  factList: document.querySelector("#fact-list"),
  choices: document.querySelector("#choices"),
  state: document.querySelector("#state"),
  restart: document.querySelector("#restart"),
};

let state = {};
let pendingEffects = [];
let pendingEchoes = [];
let visited = [];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function showError(message) {
  ui.error.hidden = false;
  ui.error.textContent = `运行错误：${message}`;
}

function compare(left, operator, right) {
  switch (operator) {
    case "==": return left === right;
    case "!=": return left !== right;
    case ">": return left > right;
    case ">=": return left >= right;
    case "<": return left < right;
    case "<=": return left <= right;
    default: throw new Error(`不支持的比较符：${operator}`);
  }
}

function parseValue(token) {
  const value = token.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (!(value in state)) throw new Error(`条件引用未定义变量：${value}`);
  return state[value];
}

function evaluateAtom(expression) {
  const text = expression.trim();
  if (text.startsWith("not ")) return !evaluateAtom(text.slice(4));
  const match = text.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (!match) {
    if (!(text in state)) throw new Error(`无法解析条件：${text}`);
    return Boolean(state[text]);
  }
  const [, variable, operator, rightToken] = match;
  if (!(variable in state)) throw new Error(`条件引用未定义变量：${variable}`);
  return compare(state[variable], operator, parseValue(rightToken));
}

function evaluate(expression) {
  return expression
    .split(/\s+or\s+/i)
    .some((orPart) => orPart.split(/\s+and\s+/i).every(evaluateAtom));
}

function conditionsMatch(group = {}) {
  const all = group.all || [];
  const any = group.any || [];
  const none = group.none || [];
  if (!all.every(evaluate)) return false;
  if (any.length && !any.some(evaluate)) return false;
  if (none.some(evaluate)) return false;
  return true;
}

function applyChanges(changes = {}) {
  for (const [key, value] of Object.entries(changes)) {
    if (!(key in state)) throw new Error(`写入未初始化变量：${key}`);
    state[key] = value;
  }
}

function applyNodeEntry(nodeId, node) {
  applyChanges(node.effects || {});
  const remaining = [];
  for (const item of pendingEffects) {
    if (item.target === nodeId) applyChanges(item.changes || {});
    else remaining.push(item);
  }
  pendingEffects = remaining;
}

function collectEchoes(nodeId, node) {
  const result = [];
  for (const item of node.echoes || []) {
    if (evaluate(item.condition)) result.push(item.text);
  }
  const remaining = [];
  for (const item of pendingEchoes) {
    if (item.target === nodeId) result.push(item.text);
    else remaining.push(item);
  }
  pendingEchoes = remaining;
  return [...new Set(result)];
}

function info(text, type = "") {
  const item = document.createElement("div");
  item.className = `info ${type}`.trim();
  item.textContent = text;
  return item;
}

function renderList(section, container, items) {
  container.replaceChildren(...items);
  section.hidden = items.length === 0;
}

function renderFacts(node) {
  const items = [];
  for (const id of node.claims || []) {
    items.push(info(`有人提出：${PALACE_STORY.facts[id]}`, "claim"));
  }
  for (const id of node.confirmed || []) {
    items.push(info(`已确认：${PALACE_STORY.facts[id]}`, "confirmed"));
  }
  for (const id of node.disproved || []) {
    items.push(info(`已否定：${PALACE_STORY.facts[id]}`, "disproved"));
  }
  renderList(ui.factSection, ui.factList, items);
}

function renderState() {
  ui.state.textContent = JSON.stringify(state, null, 2);
}

function createChoiceButton(choiceId, choice) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "choice";

  const title = document.createElement("strong");
  title.textContent = choice.label;
  button.append(title);

  if (choice.hint) {
    const hint = document.createElement("span");
    hint.textContent = choice.hint;
    button.append(hint);
  }

  button.addEventListener("click", () => selectChoice(choiceId, choice));
  return button;
}

function createContinueButton(next) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "choice";
  button.innerHTML = "<strong>继续</strong>";
  button.addEventListener("click", () => enterNode(next));
  return button;
}

function renderEnding(node, echoes) {
  const ending = PALACE_STORY.endings[node.ending];
  if (!ending) throw new Error(`缺少结局定义：${node.ending}`);
  if (!conditionsMatch(ending.conditions)) {
    throw new Error(`到达结局但条件不满足：${node.ending}`);
  }

  for (const item of ending.echoes || []) {
    if (evaluate(item.condition)) echoes.push(item.text);
  }
  renderList(ui.echoSection, ui.echoList, [...new Set(echoes)].map((text) => info(text, "echo")));

  const restart = document.createElement("button");
  restart.type = "button";
  restart.className = "choice";
  restart.innerHTML = "<strong>重新开始</strong><span>尝试另一种证据与关系路径</span>";
  restart.addEventListener("click", resetGame);
  ui.choices.append(restart);
}

function renderNode(nodeId, node) {
  ui.nodeType.textContent = node.type;
  ui.progress.textContent = `已经过 ${visited.length} 个节点`;
  ui.nodeTitle.textContent = node.title;
  ui.nodeText.textContent = node.text;
  ui.choices.replaceChildren();

  const echoes = collectEchoes(nodeId, node);
  renderList(ui.echoSection, ui.echoList, echoes.map((text) => info(text, "echo")));
  renderList(ui.clueSection, ui.clueList, (node.clues || []).map((text) => info(text)));
  renderFacts(node);

  if (node.ending) {
    renderEnding(node, echoes);
  } else {
    const available = (node.choices || [])
      .map((id) => [id, PALACE_STORY.choices[id]])
      .filter(([, choice]) => choice && conditionsMatch(choice.conditions));

    for (const [id, choice] of available) {
      ui.choices.append(createChoiceButton(id, choice));
    }
    if (!available.length && node.next) ui.choices.append(createContinueButton(node.next));
    if (!available.length && !node.next) ui.choices.append(info("当前状态下没有可用出口。", "disproved"));
  }
  renderState();
}

function enterNode(nodeId) {
  const node = PALACE_STORY.nodes[nodeId];
  if (!node) return showError(`节点不存在：${nodeId}`);
  try {
    visited.push(nodeId);
    applyNodeEntry(nodeId, node);
    renderNode(nodeId, node);
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
}

function selectChoice(choiceId, choice) {
  try {
    applyChanges(choice.effects || {});
    pendingEffects.push(...clone(choice.delayed || []));
    pendingEchoes.push(...clone(choice.echoes || []));
    visited.push(choiceId);
    enterNode(choice.next);
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
}

function resetGame() {
  ui.error.hidden = true;
  state = clone(PALACE_STORY.initialState);
  pendingEffects = [];
  pendingEchoes = [];
  visited = [];
  enterNode(PALACE_STORY.start);
}

function boot() {
  try {
    if (typeof PALACE_STORY !== "object") throw new Error("故事数据未加载");
    ui.title.textContent = PALACE_STORY.title;
    ui.theme.textContent = PALACE_STORY.theme;
    ui.restart.addEventListener("click", resetGame);
    resetGame();
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
}

boot();
