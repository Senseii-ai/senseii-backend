import { z } from "zod";
import { goalStore } from "@models/goals";
import { infoLogger } from "@utils/logger";

const layer = "SERVICE"
const name = "SCIENTIFIC_CALCULATOR"

const BmiInputSchema = z.object({
  weightKg: z.number().positive(),
  heightCm: z.number().positive(),
});

type BMIInputSchema = z.infer<typeof BmiInputSchema>

// Basic Information.
const BmrInputSchema = z.object({
  weightKg: z.number().positive(),
  heightCm: z.number().positive(),
  age: z.number().positive(),
  gender: z.string()
});


// Life Style
const TdeeInputSchema = BmrInputSchema.extend({
  activityLevel: z.string()
});

type TDEEInputSchema = z.infer<typeof TdeeInputSchema>

const MacrosInputSchema = z.object({
  tdee: z.number().positive(),
  goal: z.string(),
  weightKg: z.number().positive(),
});

type MacrosInputSchema = z.infer<typeof MacrosInputSchema>


type BMRInputSchema = z.infer<typeof BmrInputSchema>

const HealthCalculator = {
  CalculateHealthMetrics: async (userId: string) => {
    const goal = await goalStore.getUserGoal(userId)

    if (!goal.success) {
      return "user not found, show a user friendly message to the user regarding internal server error"
    }

    const { data: { basicInformation, lifeStyle, healthGoal } } = goal

    if (!basicInformation || !lifeStyle || !healthGoal) {
      let errorMessage = ""
      infoLogger({ message: "previous function calls failed", status: "alert", layer, name })
      if (!basicInformation) {
        errorMessage += "update_user_basic_information tool has not been called yet \n"
      }
      if (!lifeStyle) {
        errorMessage += "update_lifestyle tool has not been called yet"
      }
      if (!healthGoal) {
        errorMessage += "update_health_goal tool has not been called yet"
      }

      const finalMessage = errorMessage + `call the functions in that order and
      generate a user friendly message notifying them on the situation and telling
      them to run this protocol again.`
      return finalMessage
    }

    // NOTE: Expecting things to be present in the database always.
    let weight = basicInformation.weight
    if (weight.unit === "Pounds") {
      weight.value = weight.value * 0.45
      weight.unit = "Kilograms"
    } else if (weight.unit === "Grams") {
      weight.unit = "Kilograms"
      weight.value = weight.value / 1000
    }

    const BMIArgs: BMIInputSchema = {
      weightKg: weight.value,
      heightCm: basicInformation.height.value
    }

    const BMRArgs: BMRInputSchema = {
      weightKg: weight.value,
      heightCm: basicInformation.height.value,
      age: basicInformation.age,
      gender: basicInformation.gender
    }

    const TDEEArgs: TDEEInputSchema = {
      heightCm: BMRArgs.heightCm,
      weightKg: BMRArgs.weightKg,
      age: BMRArgs.age,
      gender: BMRArgs.gender,
      activityLevel: lifeStyle.dailyRoutine
    }

    const BMI = HealthCalculator.calculateBMI(BMIArgs)
    const BMR = HealthCalculator.calculateBMR(BMRArgs)
    const TDEE = HealthCalculator.calculateTDEE(TDEEArgs)

    const MacrosArgs: MacrosInputSchema = {
      tdee: TDEE,
      weightKg: BMIArgs.weightKg,
      goal: healthGoal.weightGoal
    }
    const MACROS = HealthCalculator.calculateMacros(MacrosArgs)
    return JSON.stringify({
      bmi: BMI,
      bmr: BMR,
      tdee: TDEE,
      macros: MACROS
    }
    )
  },
  /**
     * Calculate BMI (Body Mass Index)
     * Formula: weight (kg) / (height (m))^2
     */
  calculateBMI: (input: z.infer<typeof BmiInputSchema>): number => {
    const { weightKg, heightCm } = BmiInputSchema.parse(input);
    const heightMeters = heightCm / 100;
    return Number((weightKg / (heightMeters * heightMeters)).toFixed(1));
  },

  /**
     * Calculate BMR (Basal Metabolic Rate) using Mifflin-St Jeor equation
     * Male: (10 × weight in kg) + (6.25 × height in cm) - (5 × age) + 5
     * Female: (10 × weight in kg) + (6.25 × height in cm) - (5 × age) - 161
     */
  calculateBMR: (input: z.infer<typeof BmrInputSchema>): number => {
    const { weightKg, heightCm, age, gender } = BmrInputSchema.parse(input);
    const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
    return gender === "male" ? base + 5 : base - 161;
  },

  /**
   * Calculate TDEE (Total Daily Energy Expenditure)
   * Uses activity multipliers:
   * - Sedentary: 1.2
   * - Light: 1.375
   * - Moderate: 1.55
   * - Active: 1.725
   * - Very Active: 1.9
   */
  calculateTDEE: (input: z.infer<typeof TdeeInputSchema>): number => {
    const { activityLevel } = TdeeInputSchema.parse(input);
    const bmr = HealthCalculator.calculateBMR(input);

    const multipliers: Record<string, number> = {
      sedentary: 1.2,
      light: 1.375,
      moderate: 1.55,
      active: 1.725,
      very_active: 1.9
    };

    return Math.round(bmr * multipliers[activityLevel]);
  },

  /**
   * Calculate Macronutrient Targets
   * - Protein: 1.6-2.2g/kg for muscle gain, 1.2-1.6g/kg for weight loss
   * - Fat: 20-35% of total calories
   * - Carbs: Remaining calories
   */
  calculateMacros: (input: z.infer<typeof MacrosInputSchema>): {
    protein: number;
    fat: number;
    carbs: number;
  } => {
    const { tdee, goal, weightKg } = MacrosInputSchema.parse(input);

    // Protein Calculation
    const proteinGrams = goal === "gain"
      ? Math.min(Math.max(weightKg * 1.6, 120), weightKg * 2.2)
      : Math.min(Math.max(weightKg * 1.2, 80), weightKg * 1.6);

    const proteinCalories = proteinGrams * 4;

    // Fat Calculation (25% of TDEE)
    const fatCalories = tdee * 0.25;
    const fatGrams = Math.round(fatCalories / 9);

    // Carb Calculation (remaining calories)
    const remainingCalories = tdee - proteinCalories - fatCalories;
    const carbGrams = Math.round(remainingCalories / 4);

    return {
      protein: Math.round(proteinGrams),
      fat: fatGrams,
      carbs: carbGrams
    };
  }
}
export default HealthCalculator
