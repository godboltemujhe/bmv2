import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertQuizSchema, syncQuizSchema } from "@shared/schema";
import { z } from "zod";

export async function registerRoutes(app: Express): Promise<Server> {
  // CREATE API routes
  
  // GET all public quizzes
  app.get("/api/quizzes", async (req: Request, res: Response) => {
    try {
      const quizzes = await storage.getPublicQuizzes();
      // Return the array directly, not wrapped in an object
      res.json(quizzes);
    } catch (error) {
      console.error("Error fetching quizzes:", error);
      res.status(500).json({ message: "Failed to fetch quizzes" });
    }
  });
  
  // GET a quiz by its unique ID (for cross-device sync)
  // IMPORTANT: More specific routes must come before general routes with params
  app.get("/api/quizzes/unique/:uniqueId", async (req: Request, res: Response) => {
    try {
      const uniqueId = req.params.uniqueId;
      const quiz = await storage.getQuizByUniqueId(uniqueId);
      
      if (!quiz) {
        return res.status(404).json({ message: "Quiz not found" });
      }
      
      // Return the quiz directly, not wrapped in an object
      res.json(quiz);
    } catch (error) {
      console.error("Error fetching quiz by unique ID:", error);
      res.status(500).json({ message: "Failed to fetch quiz" });
    }
  });
  
  // GET a specific quiz by ID
  app.get("/api/quizzes/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid quiz ID" });
      }
      
      const quiz = await storage.getQuiz(id);
      if (!quiz) {
        return res.status(404).json({ message: "Quiz not found" });
      }
      
      // Return the quiz directly, not wrapped in an object
      res.json(quiz);
    } catch (error) {
      console.error("Error fetching quiz:", error);
      res.status(500).json({ message: "Failed to fetch quiz" });
    }
  });
  
  // CREATE a new quiz
  app.post("/api/quizzes", async (req: Request, res: Response) => {
    try {
      // Validate the request body against our schema
      const quizData = insertQuizSchema.parse(req.body);
      
      const quiz = await storage.createQuiz(quizData);
      // Return the quiz directly, not wrapped in an object
      res.status(201).json(quiz);
    } catch (error) {
      console.error("Error creating quiz:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Invalid quiz data", 
          errors: error.errors 
        });
      }
      
      res.status(500).json({ message: "Failed to create quiz" });
    }
  });
  
  // UPDATE a quiz
  app.put("/api/quizzes/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid quiz ID" });
      }
      
      // Partial validation for update
      const quizData = insertQuizSchema.partial().parse(req.body);
      
      const updatedQuiz = await storage.updateQuiz(id, quizData);
      if (!updatedQuiz) {
        return res.status(404).json({ message: "Quiz not found" });
      }
      
      // Return the quiz directly, not wrapped in an object
      res.json(updatedQuiz);
    } catch (error) {
      console.error("Error updating quiz:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Invalid quiz data", 
          errors: error.errors 
        });
      }
      
      res.status(500).json({ message: "Failed to update quiz" });
    }
  });
  
  // DELETE a quiz by uniqueId
  // IMPORTANT: More specific routes must come before general routes with params
  app.delete("/api/quizzes/unique/:uniqueId", async (req: Request, res: Response) => {
    try {
      const uniqueId = req.params.uniqueId;
      console.log(`Attempting to delete quiz with uniqueId: ${uniqueId}`);
      
      // First fetch the quiz by uniqueId
      const quiz = await storage.getQuizByUniqueId(uniqueId);
      
      if (!quiz) {
        console.log(`Quiz with uniqueId ${uniqueId} not found`);
        return res.status(404).json({ message: "Quiz not found" });
      }
      
      console.log(`Found quiz to delete: ID ${quiz.id}, title: "${quiz.title}"`);
      
      // Delete using the internal ID
      const success = await storage.deleteQuiz(quiz.id);
      if (!success) {
        console.log(`Failed to delete quiz with ID ${quiz.id}`);
        return res.status(500).json({ message: "Failed to delete quiz" });
      }
      
      console.log(`Successfully deleted quiz with ID ${quiz.id}, title: "${quiz.title}"`);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting quiz by uniqueId:", error);
      res.status(500).json({ message: "Failed to delete quiz" });
    }
  });
  
  // DELETE a quiz by ID
  app.delete("/api/quizzes/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid quiz ID" });
      }
      
      console.log(`Attempting to delete quiz with ID: ${id}`);
      
      const success = await storage.deleteQuiz(id);
      if (!success) {
        console.log(`Quiz with ID ${id} not found`);
        return res.status(404).json({ message: "Quiz not found" });
      }
      
      console.log(`Successfully deleted quiz with ID ${id}`);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting quiz:", error);
      res.status(500).json({ message: "Failed to delete quiz" });
    }
  });
  
  // Manual request to clean up duplicate quizzes
  app.post("/api/quizzes/cleanup", async (_req: Request, res: Response) => {
    try {
      console.log("Manual cleanup of duplicate quizzes requested");
      const removedCount = await storage.removeDuplicateQuizzes();
      
      if (removedCount > 0) {
        console.log(`Successfully removed ${removedCount} duplicate quizzes`);
        res.json({ 
          success: true, 
          message: `Successfully removed ${removedCount} duplicate quizzes`,
          removedCount
        });
      } else {
        console.log("No duplicate quizzes found to remove");
        res.json({ 
          success: true, 
          message: "No duplicate quizzes found to remove",
          removedCount: 0
        });
      }
    } catch (error) {
      console.error("Error cleaning up duplicate quizzes:", error);
      res.status(500).json({ 
        success: false, 
        message: "Failed to clean up duplicate quizzes" 
      });
    }
  });

  // SYNC quizzes across devices
  app.post("/api/quizzes/sync", async (req: Request, res: Response) => {
    try {
      // Pre-process the quizzes to convert string dates to Date objects
      const processedData = {
        quizzes: req.body.quizzes.map((quiz: any) => {
          return {
            ...quiz,
            // Convert string dates to Date objects
            createdAt: quiz.createdAt ? new Date(quiz.createdAt) : new Date(),
            lastTaken: quiz.lastTaken ? new Date(quiz.lastTaken) : undefined,
            // Convert string dates in quiz history if it exists
            history: quiz.history?.map((attempt: any) => ({
              ...attempt,
              date: attempt.date ? new Date(attempt.date) : new Date()
            }))
          };
        })
      };
      
      // Validate the sync request body
      const syncData = syncQuizSchema.parse(processedData);
      
      // Process the quizzes to sync - this will also run duplicate detection
      const syncedQuizzes = await storage.syncQuizzes(syncData.quizzes);
      
      // Return all PUBLIC quizzes (respect privacy) - this ensures private quizzes won't be shared
      const allPublicQuizzes = await storage.getPublicQuizzes();
      
      // Return just the array of all public quizzes, the client doesn't need to distinguish between synced and existing
      res.json(allPublicQuizzes);
    } catch (error) {
      console.error("Error syncing quizzes:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Invalid sync data", 
          errors: error.errors 
        });
      }
      
      res.status(500).json({ message: "Failed to sync quizzes" });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
