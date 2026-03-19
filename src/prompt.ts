import { Writable } from 'node:stream';
import readline from 'node:readline';
import type { WriterLike } from './types';

export interface PromptOption<T = string> {
  label: string;
  value: T;
}

export interface Prompt {
  ask(question: string): Promise<string>;
  askHidden(question: string): Promise<string>;
  choose<T>(question: string, options: PromptOption<T>[]): Promise<PromptOption<T>>;
}

function createMutedOutput(output: WriterLike): Writable {
  return new Writable({
    write(chunk, _encoding, callback) {
      output.write(String(chunk));
      callback();
    },
  });
}

export class TerminalPrompt implements Prompt {
  constructor(
    private readonly input = process.stdin,
    private readonly output: WriterLike = process.stdout
  ) {}

  async ask(question: string): Promise<string> {
    const rl = readline.createInterface({
      input: this.input,
      output: createMutedOutput(this.output),
      terminal: true,
    });

    return new Promise<string>((resolve) => {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  async askHidden(question: string): Promise<string> {
    const stdin = this.input as NodeJS.ReadStream;
    if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
      return this.ask(question);
    }

    this.output.write(question);
    readline.emitKeypressEvents(stdin);

    const previousRawMode = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();

    return new Promise<string>((resolve, reject) => {
      let answer = '';

      const cleanup = () => {
        stdin.removeListener('keypress', onKeypress);
        stdin.setRawMode(previousRawMode ?? false);
        this.output.write('\n');
      };

      const onKeypress = (chunk: string, key: readline.Key) => {
        if (key.sequence === '\u0003') {
          cleanup();
          reject(new Error('Canceled.'));
          return;
        }

        if (key.name === 'return' || key.name === 'enter') {
          cleanup();
          resolve(answer.trim());
          return;
        }

        if (key.name === 'backspace') {
          answer = answer.slice(0, -1);
          return;
        }

        if (typeof chunk === 'string' && chunk.length > 0 && !key.ctrl && !key.meta) {
          answer += chunk;
        }
      };

      stdin.on('keypress', onKeypress);
    });
  }

  async choose<T>(
    question: string,
    options: PromptOption<T>[]
  ): Promise<PromptOption<T>> {
    if (options.length === 0) {
      throw new Error('No options available.');
    }

    this.output.write(`${question}\n`);
    for (let index = 0; index < options.length; index += 1) {
      this.output.write(`  ${index + 1}. ${options[index].label}\n`);
    }

    while (true) {
      const answer = await this.ask('Choose an account number: ');
      const choice = Number.parseInt(answer, 10);
      if (
        Number.isFinite(choice) &&
        choice >= 1 &&
        choice <= options.length
      ) {
        return options[choice - 1];
      }
      this.output.write('Please enter a valid number.\n');
    }
  }
}
