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
  const prompt = `Analyze the git diff and create a comprehensive commit message.

Staged files: ${files.join(', ')}

Git diff:
${diff}

Create a commit message with this structure:

HEADER: <type>(<scope>): <short description>
BODY: <detailed explanation>

RULES FOR HEADER:
- Use conventional commit format: <type>(<scope>): <description>
- Types: feat, fix, docs, style, refactor, perf, test, chore, build, ci, revert
- Scope: main component or area being modified (e.g., auth, chat, ui, api)
- Description: imperative mood, max 50 characters, focus on WHAT changed
- Examples: "feat(chat): add message read receipts", "fix(auth): resolve login timeout"

RULES FOR BODY:
- Explain the PURPOSE and CONTEXT of changes
- Describe WHAT problem is being solved and WHY
- Mention user impact or benefits
- List main changes briefly (2-3 key points)
- Keep it concise but informative (3-5 sentences)
- Avoid implementation details, function names, file paths

IMPORTANT: 
- DO NOT include "Line 1:", "Line 2:", "HEADER:" or "BODY:" labels in your response
- Start directly with the header line, then empty line, then body

Good example:
feat(chat): enhance user profile display
Add user avatars and online status indicators to chat headers. Improve user identification in group chats and provide better visual feedback for active participants. Includes profile picture loading and status synchronization.

Now generate the commit message:`;
  
  try {
    const apiUrl = process.env.OCO_API_URL || 'http://localhost:11434/api/generate';
    const model = process.env.OCO_MODEL || 'qwen2.5-coder:14b';
    
    const res = await axios.post(apiUrl, {
      model: model,
      prompt,
      stream: false
    });
    
    const response = res.data.response.trim();
    console.log('Raw AI response:', response); // Для отладки
    
    // Убираем возможные метки Line 1, Line 2, HEADER, BODY
    let cleanedResponse = response
      .replace(/^(Line\s*\d+:\s*|HEADER:\s*|BODY:\s*)/gmi, '')
      .replace(/\n(Line\s*\d+:\s*|HEADER:\s*|BODY:\s*)/gmi, '\n');
    
    // Разделяем на header и body
    const lines = cleanedResponse.split('\n').filter((line: string) => line.trim() !== '');
    
    let header = "";
    let body = "";
    
    if (lines.length >= 2) {
      // Первая непустая строка - header, остальные - body
      header = cleanMarkdown(lines[0]);
      
      // Ищем body - все строки после header до следующего заголовка или до конца
      const bodyLines = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        // Если встречаем что-то похожее на новый header, останавливаемся
        if (line.match(/^(feat|fix|docs|style|refactor|perf|test|chore|build|ci|revert)\(.*\):/)) {
          break;
        }
        if (line) {
          bodyLines.push(line);
        }
      }
      body = cleanMarkdown(bodyLines.join(' '));
    } else if (lines.length === 1) {
      header = cleanMarkdown(lines[0]);
      body = "";
    } else {
      // Fallback
      header = "chore: update changes";
      body = "Apply various code improvements and updates";
    }
    
    // Дополнительная очистка header от остатков разметки
    header = header.replace(/^[^a-z]*([a-z])/i, '$1');
    
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