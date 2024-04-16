import { Schema, Types, model } from "mongoose"
import { IBasicInformation, ILifeStyle, IConstraints, IHealthGoals, IEatingHabits, IDietPreferences } from "../openai/assistants/nutrition/functions";

export interface IHealthPlan {
  userId: {
    type: Schema.Types.ObjectId,
    ref: "Users",
    required: true,
  },
}

// this interface is for saving the user preference in the database
interface IUserPreferences {
  user: Schema.Types.ObjectId
  type: "userPreferences"
  basicInformation: IBasicInformation;
  lifeStyle: ILifeStyle;
  dietPreferences: IDietPreferences;
  healthGoals: IHealthGoals;
  eatingHabits: IEatingHabits;
  constraints: IConstraints;
}

// when all basic information is achieved, store it in a database.
export const UserPerferences = new Schema<IUserPreferences>({
  user: {
    type: Schema.Types.ObjectId,
    ref: "Users",
    required: true,
  },
  basicInformation: {
    age: Number,
    weight: {
      value: Number,
      unit: {
        type: String,
        enum: ["Kilograms", "Grams", "Pounds"]
      },
    },
    height: {
      value: Number,
      unit: {
        type: String,
        enum: ["Centimeters"]
      }
    },
    gender: String,
  },
  lifeStyle: {
    dailyRoutine: {
      type: String,
      enum: ["sedenatry", "light", "moderate", "heavy", "very heavy"]
    },
    exerciseRoutine: [{
      exerciseType: {
        type: String,
        enum: ["cardio", "strength", "flexibility", "balance", "none"]
      },
      frequency: {
        type: String,
        enum: ["daily", "weekly", "monthly"]
      }
    }]
  },
  dietPreferences: {
    preference: {
      type: String,
      enum: ["vegetarian"
        , "non-vegetarian"
        , "vegan"
        , "pescatarian"
        , "omnivore"
        , "ketogenic"
        , "paleo"]
    },
    allergies: [String],
    intolerances: [String],
    dislikedFood: [String],
    favouriteFood: [String]
  }
})