#!/usr/bin/env node
import { execSync } from "child_process";
import axios from "axios";
import * as dotenv from 'dotenv';

dotenv.config();

// Проверяем, есть ли --dry-run
const dryRun = process.argv.includes("-d");

// Получаем staged файлы
function getStagedFiles(): string[] {
  try {
    const output = execSync("git diff --cached --name-only", { encoding: "utf-8" });
    return output.split("\n").filter((f) => f.trim() !== "");
  } catch {
    console.error("Error: Not a git repository or no staged files.");
    process.exit(1);
  }
}

// Очищаем текст от Markdown разметки
function cleanMarkdown(text: string): string {
  return text
    .replace(/^```[a-z]*\n?/g, '') // Убираем начало code block
    .replace(/\n?```$/g, '') // Убираем конец code block
    .replace(/`([^`]+)`/g, '$1') // Убираем inline code
    .replace(/\*\*([^*]+)\*\*/g, '$1') // Убираем bold
    .replace(/\*([^*]+)\*/g, '$1') // Убираем italic
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Убираем ссылки
    .replace(/^#+\s*/gm, '') // Убираем заголовки
    .replace(/\n{3,}/g, '\n\n') // Убираем лишние переносы
    .trim();
}

// Генерация commit message через API
async function generateCommitMessage(diff: string, files: string[]): Promise<{header: string, body: string}> {
  const prompt = `Analyze the git diff and generate a conventional commit message with header and body.

Staged files: ${files.join(', ')}

Git diff:
${diff}

Generate exactly two lines without any labels:
First line: Header in format "type(scope): description" (max 50 chars)
Second line: Body describing the purpose and impact (2-3 sentences)

STRICT RULES:
- Header MUST follow: <type>(<scope>): <description>
- Types: feat, fix, refactor, perf, chore, docs ONLY
- Scope: specific component from changed files
- Description: imperative mood, under 50 chars, what changed
- Body: 2-3 sentences MAX, specific purpose and user benefit
- NO "Line 1:", "Line 2:", "Header:", "Body:" labels
- NO generic terms like "improve", "enhance", "update", "extend"
- NO implementation details like "add function", "update imports"
- NO file names in description
- If multiple changes, focus on the main significant one

Examples:
feat(chat): add message reactions
Users can react with emojis for quick feedback without typing messages. Increases engagement in conversations.

fix(auth): resolve session expiration
Extend token lifetime from 1 to 4 hours. Users remain logged in during typical work sessions.

refactor(images): optimize file loading
Implement lazy loading for attachments. Reduces initial page load time by 30%.

Now generate exactly two lines without any labels:`;
  
  try {
    const res = await axios.post(process.env.OCO_API_URL ?? '', {
      model: process.env.OCO_MODEL,
      prompt,
      stream: false
    });
    
    const response = res.data.response.trim();
    
    // Обрабатываем ответ - разбиваем на строки
    const lines = response.split('\n').filter((line:string ) => line.trim() !== '');
    
    let header = "";
    let body = "";
    
    if (lines.length >= 2) {
      // Берём первую строку как header, остальные как body
      header = cleanMarkdown(lines[0]);
      body = cleanMarkdown(lines.slice(1).join(' '));
    } else if (lines.length === 1) {
      // Если только одна строка, используем её как header
      header = cleanMarkdown(lines[0]);
      body = "";
    } else {
      // Fallback
      header = "chore: update changes";
      body = "Apply various code improvements and updates";
    }
    
    return { header, body };
  } catch (err) {
    console.error("Error generating commit message:", err);
    process.exit(1);
  }
}

// Получаем git diff для staged файлов
function getGitDiff(): string {
  try {
    const diff = execSync(`git diff --cached`, { encoding: "utf-8" });
    if (!diff) {
      console.error("No staged changes to commit.");
      process.exit(1);
    }
    return diff;
  } catch {
    console.error("Error getting git diff:");
    process.exit(1);
  }
}

// Создаём коммит
function createGitCommit(header: string, body: string) {
  try {
    let commitCommand;
    if (body.trim()) {
      // Если есть описание, создаём многострочный коммит
      const safeHeader = header.replace(/"/g, '\\"');
      const safeBody = body.replace(/"/g, '\\"');
      commitCommand = `git commit -m "${safeHeader}" -m "${safeBody}"`;
    } else {
      // Если нет описания, только заголовок
      commitCommand = `git commit -m "${header.replace(/"/g, '\\"')}"`;
    }
    
    execSync(commitCommand, { stdio: "inherit" });
    console.log("Commit created successfully!");
  } catch {
    console.error("Error creating git commit.");
    process.exit(1);
  }
}

// Основная функция
async function main() {
  const files = getStagedFiles();
  if (files.length === 0) {
    console.error("No staged files to commit.");
    process.exit(1);
  }

  const diff = getGitDiff();
  const commitMessage = await generateCommitMessage(diff, files);

  if (dryRun) {
    console.log("\n=== GENERATED COMMIT MESSAGE (DRY RUN) ===");
    console.log(`Header: ${commitMessage.header}`);
    if (commitMessage.body) {
      console.log(`Body: ${commitMessage.body}`);
    }
    console.log("\n=== GIT COMMAND ===");
    if (commitMessage.body) {
      console.log(`git commit -m "${commitMessage.header}" -m "${commitMessage.body}"`);
    } else {
      console.log(`git commit -m "${commitMessage.header}"`);
    }
  } else {
    console.log("Generated commit message:");
    console.log(`Header: ${commitMessage.header}`);
    if (commitMessage.body) {
      console.log(`Body: ${commitMessage.body}`);
    }
    createGitCommit(commitMessage.header, commitMessage.body);
  }
}

main();