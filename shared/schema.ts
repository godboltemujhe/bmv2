import { pgTable, text, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Quiz categories 
export const QuizCategoryEnum = z.enum([
  'General Knowledge',
  'Mathematics',
  'Science',
  'Reasoning',
  'Custom'
]);

// Extend with custom string to allow user-defined categories
export const QuizCategorySchema = z.union([
  QuizCategoryEnum,
  z.string().min(1).max(50)
]);

export type QuizCategory = z.infer<typeof QuizCategorySchema>;

// Define question type
export const QuestionSchema = z.object({
  question: z.string(),
  answerDescription: z.string(),
  options: z.array(z.string()),
  correctAnswer: z.string(),
  questionImages: z.array(z.string()),
  answerImages: z.array(z.string())
});

export type Question = z.infer<typeof QuestionSchema>;

// Define quiz attempt type
export const QuizAttemptSchema = z.object({
  date: z.coerce.date(),
  score: z.number(),
  totalQuestions: z.number(),
  timeSpent: z.number()
});

export type QuizAttempt = z.infer<typeof QuizAttemptSchema>;

// Database table for quizzes
export const quizzes = pgTable("quizzes", {
  id: serial("id").primaryKey(),
  uniqueId: text("unique_id").notNull().unique(), // For cross-device sync
  title: text("title").notNull(),
  description: text("description").notNull(),
  questions: jsonb("questions").notNull().$type<Question[]>(),
  timer: integer("timer").notNull(),
  category: text("category").notNull(), // Using QuizCategory
  history: jsonb("history").$type<QuizAttempt[]>(), // Optional history
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastTaken: timestamp("last_taken"),
  password: text("password"), // Optional password
  isPublic: boolean("is_public").notNull().default(true),
  createdBy: integer("created_by").references(() => users.id),
  version: integer("version").notNull().default(1)
});

// Quiz insert schema
export const insertQuizSchema = createInsertSchema(quizzes)
  .omit({ id: true })
  .extend({
    questions: z.array(QuestionSchema),
    category: QuizCategorySchema,
    history: z.array(QuizAttemptSchema).optional(),
  });

export type InsertQuiz = z.infer<typeof insertQuizSchema>;
export type Quiz = typeof quizzes.$inferSelect;

// Schema for synchronizing quizzes between devices
export const syncQuizSchema = z.object({
  quizzes: z.array(insertQuizSchema)
});

export type SyncQuizRequest = z.infer<typeof syncQuizSchema>;
