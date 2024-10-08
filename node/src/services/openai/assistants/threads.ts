import { ThreadCreateParams } from "openai/resources/beta/threads/threads";
import { AzureOpenAI } from "openai";
import { createRun } from "./run";
import { getOpenAIClient } from "../openai.client";
import { MessageCreateParams } from "openai/resources/beta/threads/messages";

const client = getOpenAIClient();

// addMessageToThread adds a message to a thread, when a threadId is provided.
const addMessageToThread = async (
  client: AzureOpenAI,
  threadId: string,
  inputMessage: MessageCreateParams,
) => {
  try {
    const addedMessage = await client.beta.threads.messages.create(
      threadId,
      inputMessage,
    );
    return addedMessage;
  } catch (error) {
    console.error("Error adding message to thread");
    throw error;
  }
};

// createMessage creates a message in a thread, when a message and threadId are provided.
export const createMessage = async (
  message: string,
  client: AzureOpenAI,
  threadId: string,
) => {
  try {
    // create the message
    const inputMessage: MessageCreateParams = {
      role: "user",
      content: message,
    };

    // add message to the thread
    const addedMessage = await addMessageToThread(
      client,
      threadId,
      inputMessage,
    );
    return addedMessage;
  } catch (error) {
    console.error("Error creating message and adding to the thread");
    throw error;
  }
};

export const continueThread = async (
  threadId: string,
  client: AzureOpenAI,
  message: MessageCreateParams,
  assistantId: string,
) => {
  try {
    client.beta.threads.messages.create(threadId, message);
    const response = await createRun(threadId, client, assistantId);
    return response;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export const getNewThreadWithMessages = async (
  message: ThreadCreateParams.Message,
  client: AzureOpenAI,
): Promise<string> => {
  const messages = [message];
  const thread = await client.beta.threads.create({
    messages: messages,
  });
  return thread.id;
};

export const getNewEmptyThread = async (client: AzureOpenAI) => {
  const thread = await client.beta.threads.create();
  return thread;
};

export const getThreadById = async (threadId: string, client: AzureOpenAI) => {
  const thread = await client.beta.threads.retrieve(threadId);
  return thread;
};

export const retrieveMessages = async (
  threadId: string,
  client: AzureOpenAI,
) => {
  const messages = await client.beta.threads.messages.list(threadId);
  return messages;
};
