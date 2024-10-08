import { createNutritionPlanSchema } from "../nutrition/nutrition.functions";
import { getOpenAIClient } from "../../openai.client";

const client = getOpenAIClient();

// list of all the functions supported by the core assistant.
export interface ITestCoreToolArguments {
  type: "testCoreToolArguments";
  // the type of the core tool arguments
  coreToolArguments: any;
  // the core tool arguments
}

export const testCoreToolFunction = async () => {
  console.log("testing core tool function");
};
export type CoreToolArguments = ITestCoreToolArguments;

const testFunction = {
  name: "testCoreToolArguments",
  function: testCoreToolFunction,
};

export const coreAssistantFunctions = {
  testFunction,
};

// TODO: improve the naming convention of the functions.
export const getCoreAssistantFunctions = () => {
  return coreAssistantFunctions;
};

export const loadNutritionPlanCreationFunction = async (
  assistantId: string,
) => {
  const response = await client.beta.assistants.update(assistantId, {
    tools: [
      {
        type: "function",
        function: createNutritionPlanSchema(),
      },
    ],
  });
};

