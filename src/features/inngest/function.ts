// src/inngest/functions.ts

import { prisma } from "@/lib/db";
import { inngest } from "./client";
import { Sandbox } from "@e2b/code-interpreter";
import { MessageRole, MessageType } from "@/generated/prisma/browser";
import {
  createAgent,
  createNetwork,
  createState,
  createTool,
  openai,
} from "@inngest/agent-kit";
import { FRAGMENT_TITLE_PROMPT, PROMPT, RESPONSE_PROMPT } from "@/lib/prompt";
import z from "zod";
import { agentOutputText, captureTaskSummary, connectSandbox } from "./utils";

export interface CodeAgentState {
  sandboxId: string;
  summary: string;
  files: Record<string, string>;
}

export const processTask = inngest.createFunction(
  { id: "process-task", triggers: { event: "app/task.created" } },
  async ({ event, step }) => {
    const result = await step.run("handle-task", async () => {
      return { processed: true, id: event.data.id };
    });

    await step.sleep("pause", "1s");

    return { message: `Task ${event.data.id} complete`, result };
  },
);

export const codeAgentFunction = inngest.createFunction(
  { id: "code-agent", triggers: { event: "code-agent/run" } },
  async ({ event, step }) => {
    const sandboxId = await step.run("get-sandbox-id", async () => {
      const sandbox = await Sandbox.create({
        template: "08behmq3n14zj1ghsz0z",
      });
      return sandbox.sandboxId;
    });

    const previousMessage = await step.run("get-previous-message", async () => {
      const messages = await prisma.message.findMany({
        where: {
          projectId: event.data.projectId,
        },
        orderBy: {
          createdAt: "asc",
        },
      });
      return messages.map((message) => ({
        type: "text" as const,
        role:
          message.role === MessageRole.ASSISTANT
            ? ("assistant" as const)
            : ("user" as const),
        content: message.content,
      }));
    });

    const state = createState<CodeAgentState>(
      { sandboxId, summary: "", files: {} },
      { messages: previousMessage },
    );

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY is not configured");
    }

    const geminiModel = openai({
      model: "thinkingmachines/inkling:free",
      step,
      apiKey: process.env.OPENROUTER_API_KEY!,
      baseUrl: "https://openrouter.ai/api/v1",
      defaultParameters: {
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 8192,
          thinkingConfig: { thinkingBudget: 0 },
        },
      },
    } as Parameters<typeof openai>[0]);

    const codeAgent = createAgent({
      name: "code-agent",
      description: "An expert coding agent",
      system: PROMPT,
      model: openai({ model: "thinkingmachines/inkling:free" }),
      tools: [
        createTool({
          name: "terminal",
          description: "use the terminal to run commands",
          parameters: z.object({ command: z.string() }),
          handler: async ({ command }, { step: toolStep, network }) => {
            return toolStep?.run(`terminal-${command}`, async () => {
              const buffers = { stdout: "", stderr: "" };

              try {
                const sandbox = await connectSandbox(
                  network!.state.data.sandboxId,
                );

                const result = await sandbox.commands.run(command, {
                  onStdout(data) {
                    buffers.stdout += data;
                  },
                  onStderr(data) {
                    buffers.stderr += data;
                  },
                });

                return result.stdout;
              } catch (error) {
                return `Command failed: ${error}\nstdout ${buffers.stdout}\nstderr: ${buffers.stderr}`;
              }
            });
          },
        }),

        createTool({
          name: "createOrUpdateFile",
          description:
            "Create or update one file in the sandbox. call this tool once per file with a relative path and full file contents.",
          parameters: z.object({
            path: z.string().describe("Relative file path e.g app/page.tsx"),
            content: z.string().describe("Full content of the file"),
          }),
          handler: async ({ path, content }, { step: toolStep, network }) => {
            return toolStep?.run(`create-or-update-file-${path}`, async () => {
              try {
                const sandbox = await connectSandbox(
                  network!.state.data.sandboxId,
                );

                await sandbox.files.write(path, content);
                network!.state.data.files[path] = content;

                return `Files ${path} created or updated`;
              } catch (error) {
                return `Failed to create or update file ${path}: ${error}`;
              }
            });
          },
        }),

        createTool({
          name: "readFiles",
          description: "Read files in the sandbox",
          parameters: z.object({ files: z.array(z.string()) }),
          handler: async ({ files }, { step: toolStep, network }) => {
            return toolStep?.run(`read-files-${files.length}`, async () => {
              try {
                const sandbox = await connectSandbox(
                  network!.state.data.sandboxId,
                );
                const contents = [];

                for (const file of files) {
                  contents.push({
                    path: file,
                    content: await sandbox.files.read(file),
                  });
                }

                return JSON.stringify(contents);
              } catch (error) {
                return `Error : ${error}`;
              }
            });
          },
        }),
      ],

      lifecycle: {
        onResponse: async ({ result, network }) => {
          captureTaskSummary(result, network);
          return result;
        },
      },
    });

    const network = createNetwork({
      name: "code-agent-network",
      agents: [codeAgent],
      maxIter: 15,
      router: async ({ network }) =>
        network.state.data.summary ? undefined : codeAgent,
    });

    const result = await network.run(event.data.value, { state });

    const { summary, files } = result.state.data;

    const makeTextAgent = (name: string, system: string) =>
      createAgent({ name, system, model: geminiModel });

    const fragmentTitleGenerator = makeTextAgent(
      "fragment-title-generator",
      FRAGMENT_TITLE_PROMPT,
    );

    const responseGenerator = makeTextAgent(
      "response-generator",
      RESPONSE_PROMPT,
    );

    const [{ output: fragmentTitleOutput }, { output: responseOutpot }] =
      await Promise.all([
        fragmentTitleGenerator.run(summary, { step }),
        responseGenerator.run(summary, { step }),
      ]);

    const fragmentTitle = agentOutputText(fragmentTitleOutput, "Untitled");
    const responseText = agentOutputText(responseOutpot, "Here you go");

    const isError = !summary || Object.keys(files).length === 0;
    const sandboxUrl = await step.run("get-sandbox-url", async () => {
      const sandbox = await connectSandbox(sandboxId);

      return `http://${sandbox.getHost(3000)}`;
    });

    await step.run("save-result", async () => {
      if (isError) {
        return prisma.message.create({
          data: {
            projectId: event.data.projectId,
            content: "something went wrong. please try again",
            role: MessageRole.ASSISTANT,
            type: MessageType.ERROR,
          },
        });
      }

      return prisma.message.create({
        data: {
          projectId: event.data.projectId,
          content: responseText,
          role: MessageRole.ASSISTANT,
          type: MessageType.RESULT,
          fragments: {
            create: {
              sandboxUrl,
              title: fragmentTitle,
              files,
            },
          },
        },
      });
    });

    return {
      url: sandboxUrl,
      title: fragmentTitle,
      files,
      summary,
    };
  },
);
