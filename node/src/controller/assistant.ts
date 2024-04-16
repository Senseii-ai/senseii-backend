const supportedAssistants = [
  "core", "fitness", "nutrition"
]

const client = getOpenAIClient()

import { Request, Response } from "express"
import { IAuthRequest } from "../middlewares/auth"
import { getCoreAssistantTools } from "../openai/assistants/core/assistant"
import { getOpenAIClient } from "../openai/client"
import chalk from "chalk"

// get the functions of the core assistant
export const getFunctions = async (req: IAuthRequest, res: Response) => {
  try {
    const assistantName = req.params.assistantId
    if (supportedAssistants.includes(assistantName)) {
      const tools = await getCoreAssistantTools(client)
      return res.status(200).json({ tools: tools })
    }
  } catch (error) {
    console.error(chalk.red(error))
    throw error
  }
}

// internal function
export const _getAssistantants = async (req: Request, res: Response) => {
  try {
    const assistants = 
  } catch (error) {

  }
}