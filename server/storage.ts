import { type User, type InsertUser, type Quiz, type InsertQuiz } from "@shared/schema";
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// modify the interface with any CRUD methods
// you might need

export interface IStorage {
  // User methods
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Quiz methods
  getQuiz(id: number): Promise<Quiz | undefined>;
  getQuizByUniqueId(uniqueId: string): Promise<Quiz | undefined>;
  getAllQuizzes(): Promise<Quiz[]>;
  getPublicQuizzes(): Promise<Quiz[]>;
  createQuiz(quiz: InsertQuiz): Promise<Quiz>;
  updateQuiz(id: number, quiz: Partial<InsertQuiz>): Promise<Quiz | undefined>;
  deleteQuiz(id: number): Promise<boolean>;
  syncQuizzes(quizzesToSync: InsertQuiz[]): Promise<Quiz[]>;
  deletePrivateQuizzes(): Promise<number>; // Clean up storage by removing private quizzes
  removeDuplicateQuizzes(): Promise<number>; // Clean up duplicate quizzes (same uniqueId or content)
}

// In-memory storage for development
// Optimized for cross-platform compatibility and different Node.js versions
export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private quizCollection: Map<number, Quiz>;
  userCurrentId: number;
  quizCurrentId: number;

  constructor() {
    this.users = new Map();
    this.quizCollection = new Map();
    this.userCurrentId = 1;
    this.quizCurrentId = 1;
    
    // Log initialization for debugging
    console.log("MemStorage initialized");
  }

  // User methods
  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.userCurrentId++;
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }
  
  // Quiz methods
  async getQuiz(id: number): Promise<Quiz | undefined> {
    return this.quizCollection.get(id);
  }
  
  async getQuizByUniqueId(uniqueId: string): Promise<Quiz | undefined> {
    return Array.from(this.quizCollection.values()).find(
      (quiz) => quiz.uniqueId === uniqueId
    );
  }
  
  async getAllQuizzes(): Promise<Quiz[]> {
    return Array.from(this.quizCollection.values());
  }
  
  async getPublicQuizzes(): Promise<Quiz[]> {
    return Array.from(this.quizCollection.values()).filter(
      (quiz) => quiz.isPublic === true
    );
  }
  
  async createQuiz(quiz: InsertQuiz): Promise<Quiz> {
    const id = this.quizCurrentId++;
    
    // Make sure uniqueId is set
    if (!quiz.uniqueId) {
      quiz.uniqueId = uuidv4();
    }
    
    // Make sure version is set
    const version = quiz.version || 1;
    
    // Set password to null if undefined
    const password = quiz.password === undefined ? null : quiz.password;
    
    // Cast to Quiz type to satisfy type constraints
    const newQuiz = {
      ...quiz,
      id,
      createdAt: quiz.createdAt || new Date(),
      version,
      password
    } as Quiz;
    
    this.quizCollection.set(id, newQuiz);
    return newQuiz;
  }
  
  async updateQuiz(id: number, quizUpdate: Partial<InsertQuiz>): Promise<Quiz | undefined> {
    const existingQuiz = this.quizCollection.get(id);
    
    if (!existingQuiz) {
      return undefined;
    }
    
    const updatedQuiz: Quiz = { 
      ...existingQuiz, 
      ...quizUpdate,
      version: existingQuiz.version ? existingQuiz.version + 1 : 1
    };
    
    this.quizCollection.set(id, updatedQuiz);
    return updatedQuiz;
  }
  
  async deleteQuiz(id: number): Promise<boolean> {
    return this.quizCollection.delete(id);
  }
  
  // Clean up private quizzes to save server storage
  async deletePrivateQuizzes(): Promise<number> {
    let count = 0;
    
    // Get all quizzes that are private
    const privateQuizzes = Array.from(this.quizCollection.values())
      .filter(quiz => !quiz.isPublic);
    
    // Delete each private quiz
    for (const quiz of privateQuizzes) {
      if (this.quizCollection.delete(quiz.id)) {
        count++;
      }
    }
    
    console.log(`Deleted ${count} private quizzes to save server storage`);
    return count;
  }
  
  // Helper function to create a content hash for quiz comparison
  private createContentHash(quiz: Quiz): string {
    // Create a simplified representation for comparison
    const titleNormalized = quiz.title.toLowerCase().trim();
    
    // Only include essential question data if available
    const questionsData = quiz.questions ? quiz.questions.map(q => ({
      question: typeof q.question === 'string' ? q.question.toLowerCase().trim() : '',
      options: Array.isArray(q.options) 
        ? q.options.map(opt => typeof opt === 'string' ? opt.toLowerCase().trim() : '').sort().join('|')
        : '',
      correctAnswer: typeof q.correctAnswer === 'string' ? q.correctAnswer.toLowerCase().trim() : ''
    })) : [];
    
    // Sort questions for consistent comparison
    if (questionsData.length > 0) {
      questionsData.sort((a, b) => a.question.localeCompare(b.question));
    }
    
    // Create a hash
    return `${titleNormalized}:${questionsData.length}:${JSON.stringify(questionsData)}`;
  }
  
  // Method to identify and remove duplicate quizzes
  async removeDuplicateQuizzes(): Promise<number> {
    console.log("Running server-side duplicate quiz detection...");
    
    // Track performance
    const startTime = performance.now();
    
    // Get all quizzes
    const allQuizzes = Array.from(this.quizCollection.values());
    
    // Maps to track uniqueness
    const uniqueIdMap = new Map<string, Quiz>();  // For uniqueId tracking
    const contentHashMap = new Map<string, Quiz>(); // For content similarity tracking
    const uniqueQuizIds = new Set<number>();      // IDs to keep
    const duplicatesRemoved: Quiz[] = [];         // Quizzes to remove
    
    // First pass - identify duplicates by uniqueId 
    for (const quiz of allQuizzes) {
      // Skip quizzes without uniqueId
      if (!quiz.uniqueId) {
        uniqueQuizIds.add(quiz.id);
        continue;
      }
      
      if (!uniqueIdMap.has(quiz.uniqueId)) {
        // First occurrence of this uniqueId
        uniqueIdMap.set(quiz.uniqueId, quiz);
        uniqueQuizIds.add(quiz.id);
      } else {
        // Duplicate by uniqueId - keep newer version
        const existingQuiz = uniqueIdMap.get(quiz.uniqueId)!;
        
        // Determine which one is newer by version or createdAt
        const keepNew = (quiz.version && existingQuiz.version && quiz.version > existingQuiz.version) ||
          (quiz.createdAt && existingQuiz.createdAt && 
           new Date(quiz.createdAt).getTime() > new Date(existingQuiz.createdAt).getTime());
        
        if (keepNew) {
          // Remove the existing quiz from our tracked set
          uniqueQuizIds.delete(existingQuiz.id);
          uniqueQuizIds.add(quiz.id);
          uniqueIdMap.set(quiz.uniqueId, quiz);
          duplicatesRemoved.push(existingQuiz);
          console.log(`Replacing duplicate quiz by uniqueId: "${existingQuiz.title}" with newer version`);
        } else {
          // Current quiz is older or same version
          console.log(`Skipping older duplicate quiz by uniqueId: "${quiz.title}"`);
          duplicatesRemoved.push(quiz);
        }
      }
    }
    
    // Second pass - identify duplicates by content
    for (const quiz of allQuizzes) {
      // Skip if already marked as duplicate in first pass
      if (!uniqueQuizIds.has(quiz.id)) continue;
      
      if (!quiz.uniqueId) {
        // Only apply content hash to quizzes without uniqueId
        const contentHash = this.createContentHash(quiz);
        
        if (!contentHashMap.has(contentHash)) {
          // First occurrence of this content
          contentHashMap.set(contentHash, quiz);
        } else {
          // Duplicate by content hash - keep newest version
          const existingQuiz = contentHashMap.get(contentHash)!;
          
          // Determine which to keep based on creation date or version
          const keepNew = (quiz.version && existingQuiz.version && quiz.version > existingQuiz.version) ||
            (quiz.createdAt && existingQuiz.createdAt && 
             new Date(quiz.createdAt).getTime() > new Date(existingQuiz.createdAt).getTime());
          
          if (keepNew) {
            // Replace the existing quiz with the newer one
            uniqueQuizIds.delete(existingQuiz.id);
            uniqueQuizIds.add(quiz.id);
            contentHashMap.set(contentHash, quiz);
            duplicatesRemoved.push(existingQuiz);
            console.log(`Found duplicate quiz by content: "${existingQuiz.title}" - keeping newer version`);
          } else {
            // Current quiz is older
            uniqueQuizIds.delete(quiz.id);
            duplicatesRemoved.push(quiz);
            console.log(`Found duplicate quiz by content: "${quiz.title}" - keeping newer version`);
          }
        }
      }
    }
    
    // Third pass - check for quizzes with the same title but different uniqueIds
    // This helps catch duplicates that might have been missed in previous passes
    const titleMap = new Map<string, Quiz[]>();
    const finalUniqueQuizIds = new Set<number>(uniqueQuizIds);
    
    // Group quizzes by normalized title
    for (const quiz of allQuizzes) {
      if (!uniqueQuizIds.has(quiz.id)) continue;
      
      const normalizedTitle = quiz.title.toLowerCase().trim();
      
      if (!titleMap.has(normalizedTitle)) {
        titleMap.set(normalizedTitle, [quiz]);
      } else {
        titleMap.get(normalizedTitle)!.push(quiz);
      }
    }
    
    // Check each title group for potential duplicates
    for (const [title, quizzesWithSameTitle] of titleMap.entries()) {
      if (quizzesWithSameTitle.length > 1) {
        console.log(`Found ${quizzesWithSameTitle.length} quizzes with title "${title}" - checking for duplicates`);
        
        // Compare each quiz with others having the same title
        for (let i = 0; i < quizzesWithSameTitle.length; i++) {
          const quiz1 = quizzesWithSameTitle[i];
          
          // Skip if already removed as duplicate
          if (!finalUniqueQuizIds.has(quiz1.id)) continue;
          
          for (let j = i + 1; j < quizzesWithSameTitle.length; j++) {
            const quiz2 = quizzesWithSameTitle[j];
            
            // Skip if already removed as duplicate
            if (!finalUniqueQuizIds.has(quiz2.id)) continue;
            
            // Skip if both have different uniqueIds (intentionally different)
            if (quiz1.uniqueId && quiz2.uniqueId && quiz1.uniqueId !== quiz2.uniqueId) {
              continue;
            }
            
            // Compare questions for similarity
            if (quiz1.questions && quiz2.questions) {
              // Only compare if they have similar number of questions (±1)
              if (Math.abs(quiz1.questions.length - quiz2.questions.length) <= 1) {
                let matchCount = 0;
                
                // Count matching questions
                for (const q1 of quiz1.questions) {
                  for (const q2 of quiz2.questions) {
                    if (
                      q1.question.toLowerCase().trim() === q2.question.toLowerCase().trim() ||
                      q1.correctAnswer.toLowerCase().trim() === q2.correctAnswer.toLowerCase().trim()
                    ) {
                      matchCount++;
                      break;
                    }
                  }
                }
                
                // If 80% or more questions match, consider them duplicates
                const threshold = Math.min(quiz1.questions.length, quiz2.questions.length) * 0.8;
                if (matchCount >= threshold) {
                  console.log(`Found duplicate quizzes with title "${title}" by question similarity`);
                  
                  // Keep the newer quiz
                  const keepQuiz1 = (
                    (quiz1.version && quiz2.version && quiz1.version > quiz2.version) ||
                    (quiz1.createdAt && quiz2.createdAt && 
                     new Date(quiz1.createdAt).getTime() > new Date(quiz2.createdAt).getTime())
                  );
                  
                  if (keepQuiz1) {
                    finalUniqueQuizIds.delete(quiz2.id);
                    duplicatesRemoved.push(quiz2);
                    console.log(`Keeping quiz "${quiz1.title}" (ID: ${quiz1.id}) as it's newer`);
                  } else {
                    finalUniqueQuizIds.delete(quiz1.id);
                    duplicatesRemoved.push(quiz1);
                    console.log(`Keeping quiz "${quiz2.title}" (ID: ${quiz2.id}) as it's newer`);
                    break; // Break inner loop as quiz1 is now removed
                  }
                }
              }
            }
          }
        }
      }
    }
    
    // Delete all identified duplicates
    let deleteCount = 0;
    for (const quiz of duplicatesRemoved) {
      console.log(`Removing duplicate quiz: "${quiz.title}" (ID: ${quiz.id}, uniqueId: ${quiz.uniqueId || 'none'})`);
      if (this.quizCollection.delete(quiz.id)) {
        deleteCount++;
      }
    }
    
    // Log results
    const endTime = performance.now();
    console.log(`Removed ${deleteCount} duplicate quizzes in ${(endTime - startTime).toFixed(2)}ms`);
    
    return deleteCount;
  }
  
  async syncQuizzes(quizzesToSync: InsertQuiz[]): Promise<Quiz[]> {
    // Filter out quizzes that are explicitly private - don't store them on the server at all
    const publicQuizzesToSync = quizzesToSync.filter(quiz => quiz.isPublic === true);
    console.log(`Processing ${publicQuizzesToSync.length} public quizzes out of ${quizzesToSync.length} total quizzes`);
    
    // Process ONLY PUBLIC quizzes - private quizzes stay only on client
    for (const quizToSync of publicQuizzesToSync) {
      // Skip quizzes without a uniqueId
      if (!quizToSync.uniqueId) {
        console.log("Skipping quiz without uniqueId");
        continue;
      }
      
      // Check if quiz already exists by uniqueId
      const existingQuiz = await this.getQuizByUniqueId(quizToSync.uniqueId);
      
      if (existingQuiz) {
        // Update the existing quiz
        console.log(`Updating existing public quiz: ${quizToSync.title} (uniqueId: ${quizToSync.uniqueId})`);
        await this.updateQuiz(existingQuiz.id, quizToSync);
      } else {
        // Create new quiz
        console.log(`Creating new public quiz: ${quizToSync.title} (uniqueId: ${quizToSync.uniqueId})`);
        await this.createQuiz(quizToSync);
      }
    }
    
    // For any quiz that exists on server but is now private on client, delete it from server
    for (const quizToSync of quizzesToSync) {
      if (!quizToSync.isPublic && quizToSync.uniqueId) {
        const existingQuiz = await this.getQuizByUniqueId(quizToSync.uniqueId);
        if (existingQuiz) {
          console.log(`Quiz ${quizToSync.title} is now private - removing from server`);
          await this.deleteQuiz(existingQuiz.id);
        }
      }
    }
    
    // Clean up storage by removing any private quizzes
    await this.deletePrivateQuizzes();
    
    // Return only public quizzes
    return await this.getPublicQuizzes();
  }
}

// Database storage implementation using Drizzle ORM
export class DbStorage implements IStorage {
  private db: ReturnType<typeof drizzle>;
  
  constructor() {
    try {
      // Connect to the database using the correct Neon connection format
      const sql = neon(process.env.DATABASE_URL!);
      // Create a drizzle instance with the SQL connection - client should be first arg
      this.db = drizzle({
        driver: sql
      });
    } catch (error) {
      console.error("Database connection error:", error);
      // Create a fallback in-memory database if connection fails
      throw new Error("Database connection failed. Check your DATABASE_URL environment variable.");
    }
  }
  
  // User methods
  async getUser(id: number): Promise<User | undefined> {
    const result = await this.db.select().from(users).where(eq(users.id, id));
    return result[0];
  }
  
  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await this.db.select().from(users).where(eq(users.username, username));
    return result[0];
  }
  
  async createUser(insertUser: InsertUser): Promise<User> {
    const result = await this.db.insert(users).values(insertUser).returning();
    return result[0];
  }
  
  // Quiz methods
  async getQuiz(id: number): Promise<Quiz | undefined> {
    const result = await this.db.select().from(quizzes).where(eq(quizzes.id, id));
    return result[0];
  }
  
  async getQuizByUniqueId(uniqueId: string): Promise<Quiz | undefined> {
    const result = await this.db.select().from(quizzes).where(eq(quizzes.uniqueId, uniqueId));
    return result[0];
  }
  
  async getAllQuizzes(): Promise<Quiz[]> {
    return await this.db.select().from(quizzes);
  }
  
  async getPublicQuizzes(): Promise<Quiz[]> {
    return await this.db.select().from(quizzes).where(eq(quizzes.isPublic, true));
  }
  
  async createQuiz(quiz: InsertQuiz): Promise<Quiz> {
    // Generate a uniqueId if not provided
    if (!quiz.uniqueId) {
      quiz.uniqueId = uuidv4();
    }
    
    const result = await this.db.insert(quizzes).values(quiz).returning();
    return result[0];
  }
  
  async updateQuiz(id: number, quizUpdate: Partial<InsertQuiz>): Promise<Quiz | undefined> {
    // Increment version for tracking changes
    let currentQuiz = await this.getQuiz(id);
    if (!currentQuiz) {
      return undefined;
    }
    
    const newVersion = currentQuiz.version ? currentQuiz.version + 1 : 1;
    
    const result = await this.db.update(quizzes)
      .set({ ...quizUpdate, version: newVersion })
      .where(eq(quizzes.id, id))
      .returning();
    
    return result[0];
  }
  
  async deleteQuiz(id: number): Promise<boolean> {
    const result = await this.db.delete(quizzes).where(eq(quizzes.id, id)).returning();
    return result.length > 0;
  }

  // New method to clean up private quizzes to save server storage
  async deletePrivateQuizzes(): Promise<number> {
    const result = await this.db.delete(quizzes)
      .where(eq(quizzes.isPublic, false))
      .returning();
    
    console.log(`Deleted ${result.length} private quizzes to save server storage`);
    return result.length;
  }
  
  // Function to create a content hash for a quiz to identify duplicate content
  private createContentHash(quiz: Quiz): string {
    // Create a simplified quiz representation for comparison
    const titleNormalized = quiz.title.toLowerCase().trim();
    
    // Only include essential question data if available
    const questionsData = quiz.questions ? quiz.questions.map(q => ({
      question: typeof q.question === 'string' ? q.question.toLowerCase().trim() : '',
      options: Array.isArray(q.options) 
        ? q.options.map(opt => typeof opt === 'string' ? opt.toLowerCase().trim() : '').sort().join('|')
        : '',
      correctAnswer: typeof q.correctAnswer === 'string' ? q.correctAnswer.toLowerCase().trim() : ''
    })) : [];
    
    // Sort questions for consistent comparison
    if (questionsData.length > 0) {
      questionsData.sort((a, b) => a.question.localeCompare(b.question));
    }
    
    // Create a hash
    return `${titleNormalized}:${questionsData.length}:${JSON.stringify(questionsData)}`;
  }
  
  // Method to identify and remove duplicate quizzes in the database
  async removeDuplicateQuizzes(): Promise<number> {
    console.log("Running server-side duplicate quiz detection in database...");
    
    // Track performance
    const startTime = performance.now();
    
    // Get all quizzes
    const allQuizzes = await this.getAllQuizzes();
    
    // Maps to track uniqueness
    const uniqueIdMap = new Map<string, Quiz>();  // For uniqueId tracking 
    const contentHashMap = new Map<string, Quiz>(); // For content similarity tracking
    const quizzesToKeep = new Set<number>();     // IDs to keep
    const duplicatesToRemove: Quiz[] = [];       // Quizzes to remove
    
    // First pass - identify duplicates by uniqueId
    for (const quiz of allQuizzes) {
      // Skip quizzes without uniqueId
      if (!quiz.uniqueId) {
        quizzesToKeep.add(quiz.id);
        continue;
      }
      
      if (!uniqueIdMap.has(quiz.uniqueId)) {
        // First occurrence of this uniqueId
        uniqueIdMap.set(quiz.uniqueId, quiz);
        quizzesToKeep.add(quiz.id);
      } else {
        // Duplicate by uniqueId - keep newer version
        const existingQuiz = uniqueIdMap.get(quiz.uniqueId)!;
        
        // Determine which one is newer by version or createdAt
        const keepNew = (quiz.version && existingQuiz.version && quiz.version > existingQuiz.version) ||
          (quiz.createdAt && existingQuiz.createdAt && 
           new Date(quiz.createdAt).getTime() > new Date(existingQuiz.createdAt).getTime());
        
        if (keepNew) {
          // Replace the existing quiz with the newer one
          quizzesToKeep.delete(existingQuiz.id);
          quizzesToKeep.add(quiz.id);
          uniqueIdMap.set(quiz.uniqueId, quiz);
          duplicatesToRemove.push(existingQuiz);
          console.log(`Replacing duplicate quiz by uniqueId: "${existingQuiz.title}" with newer version`);
        } else {
          // Current quiz is older or same version
          console.log(`Skipping older duplicate quiz by uniqueId: "${quiz.title}"`);
          duplicatesToRemove.push(quiz);
        }
      }
    }
    
    // Second pass - identify duplicates by content
    for (const quiz of allQuizzes) {
      // Skip if already marked as duplicate in first pass
      if (!quizzesToKeep.has(quiz.id)) continue;
      
      if (!quiz.uniqueId) {
        // Generate content hash
        const contentHash = this.createContentHash(quiz);
        
        if (!contentHashMap.has(contentHash)) {
          // First occurrence of this content
          contentHashMap.set(contentHash, quiz);
        } else {
          // Duplicate by content hash - keep newest version
          const existingQuiz = contentHashMap.get(contentHash)!;
          
          // Determine which to keep based on creation date or version
          const keepNew = (quiz.version && existingQuiz.version && quiz.version > existingQuiz.version) ||
            (quiz.createdAt && existingQuiz.createdAt && 
             new Date(quiz.createdAt).getTime() > new Date(existingQuiz.createdAt).getTime());
          
          if (keepNew) {
            // Replace the existing quiz with the newer one
            quizzesToKeep.delete(existingQuiz.id);
            quizzesToKeep.add(quiz.id);
            contentHashMap.set(contentHash, quiz);
            duplicatesToRemove.push(existingQuiz);
            console.log(`Found duplicate quiz by content: "${existingQuiz.title}" - keeping newer version`);
          } else {
            // Current quiz is older
            quizzesToKeep.delete(quiz.id);
            duplicatesToRemove.push(quiz);
            console.log(`Found duplicate quiz by content: "${quiz.title}" - keeping newer version`);
          }
        }
      }
    }
    
    // Third pass - check for quizzes with the same title but different uniqueIds
    // This helps catch duplicates that might have been missed in previous passes
    const titleMap = new Map<string, Quiz[]>();
    const quizzesWithUniqueTitle: Quiz[] = [];
    
    // Group quizzes by normalized title
    for (const quiz of allQuizzes) {
      if (!quizzesToKeep.has(quiz.id)) continue;
      
      const normalizedTitle = quiz.title.toLowerCase().trim();
      
      if (!titleMap.has(normalizedTitle)) {
        titleMap.set(normalizedTitle, [quiz]);
        quizzesWithUniqueTitle.push(quiz);
      } else {
        titleMap.get(normalizedTitle)!.push(quiz);
      }
    }
    
    // Check each title group for potential duplicates
    for (const [title, quizzesWithSameTitle] of titleMap.entries()) {
      if (quizzesWithSameTitle.length > 1) {
        console.log(`Found ${quizzesWithSameTitle.length} quizzes with title "${title}" - checking for duplicates`);
        
        // Compare each quiz with others having the same title
        for (let i = 0; i < quizzesWithSameTitle.length; i++) {
          const quiz1 = quizzesWithSameTitle[i];
          
          // Skip if already marked as duplicate
          if (!quizzesToKeep.has(quiz1.id)) continue;
          
          for (let j = i + 1; j < quizzesWithSameTitle.length; j++) {
            const quiz2 = quizzesWithSameTitle[j];
            
            // Skip if already marked as duplicate
            if (!quizzesToKeep.has(quiz2.id)) continue;
            
            // Skip if both have different uniqueIds (we assume they're intentionally different)
            if (quiz1.uniqueId && quiz2.uniqueId && quiz1.uniqueId !== quiz2.uniqueId) {
              continue;
            }
            
            // Compare questions for similarity
            if (quiz1.questions && quiz2.questions) {
              // Only compare if they have similar number of questions (±1)
              if (Math.abs(quiz1.questions.length - quiz2.questions.length) <= 1) {
                let matchCount = 0;
                
                // Count matching questions
                for (const q1 of quiz1.questions) {
                  for (const q2 of quiz2.questions) {
                    if (
                      q1.question.toLowerCase().trim() === q2.question.toLowerCase().trim() ||
                      q1.correctAnswer.toLowerCase().trim() === q2.correctAnswer.toLowerCase().trim()
                    ) {
                      matchCount++;
                      break;
                    }
                  }
                }
                
                // If 80% or more questions match, consider them duplicates
                const threshold = Math.min(quiz1.questions.length, quiz2.questions.length) * 0.8;
                if (matchCount >= threshold) {
                  console.log(`Found duplicate quizzes with title "${title}" by question similarity`);
                  
                  // Keep the newer quiz
                  const keepQuiz1 = (
                    (quiz1.version && quiz2.version && quiz1.version > quiz2.version) ||
                    (quiz1.createdAt && quiz2.createdAt && 
                     new Date(quiz1.createdAt).getTime() > new Date(quiz2.createdAt).getTime())
                  );
                  
                  if (keepQuiz1) {
                    quizzesToKeep.delete(quiz2.id);
                    duplicatesToRemove.push(quiz2);
                    console.log(`Keeping quiz "${quiz1.title}" (ID: ${quiz1.id}) as it's newer`);
                  } else {
                    quizzesToKeep.delete(quiz1.id);
                    duplicatesToRemove.push(quiz1);
                    console.log(`Keeping quiz "${quiz2.title}" (ID: ${quiz2.id}) as it's newer`);
                    break; // Break inner loop as quiz1 is now removed
                  }
                }
              }
            }
          }
        }
      }
    }
    
    // Delete all identified duplicates
    let deleteCount = 0;
    for (const quiz of duplicatesToRemove) {
      console.log(`Removing duplicate quiz from DB: "${quiz.title}" (ID: ${quiz.id}, uniqueId: ${quiz.uniqueId || 'none'})`);
      if (await this.deleteQuiz(quiz.id)) {
        deleteCount++;
      }
    }
    
    // Log results
    const endTime = performance.now();
    console.log(`Removed ${deleteCount} duplicate quizzes in ${(endTime - startTime).toFixed(2)}ms`);
    
    return deleteCount;
  }
  
  async syncQuizzes(quizzesToSync: InsertQuiz[]): Promise<Quiz[]> {
    // Filter out quizzes that are explicitly private - don't store them on the server at all
    const publicQuizzesToSync = quizzesToSync.filter(quiz => quiz.isPublic === true);
    console.log(`Processing ${publicQuizzesToSync.length} public quizzes out of ${quizzesToSync.length} total quizzes`);
    
    // Process ONLY PUBLIC quizzes - private quizzes stay only on client
    for (const quizToSync of publicQuizzesToSync) {
      // Skip quizzes without a uniqueId
      if (!quizToSync.uniqueId) {
        console.log("Skipping quiz without uniqueId");
        continue;
      }
      
      // Check if quiz already exists by uniqueId
      const existingQuiz = await this.getQuizByUniqueId(quizToSync.uniqueId);
      
      if (existingQuiz) {
        // Update the existing quiz
        console.log(`Updating existing public quiz: ${quizToSync.title} (uniqueId: ${quizToSync.uniqueId})`);
        await this.updateQuiz(existingQuiz.id, quizToSync);
      } else {
        // Create new quiz
        console.log(`Creating new public quiz: ${quizToSync.title} (uniqueId: ${quizToSync.uniqueId})`);
        await this.createQuiz(quizToSync);
      }
    }
    
    // For any quiz that exists on server but is now private on client, delete it from server
    for (const quizToSync of quizzesToSync) {
      if (!quizToSync.isPublic && quizToSync.uniqueId) {
        const existingQuiz = await this.getQuizByUniqueId(quizToSync.uniqueId);
        if (existingQuiz) {
          console.log(`Quiz ${quizToSync.title} is now private - removing from server`);
          await this.deleteQuiz(existingQuiz.id);
        }
      }
    }
    
    // Clean up storage by removing any private quizzes
    await this.deletePrivateQuizzes();
    
    // Return only public quizzes
    return await this.getPublicQuizzes();
  }
}

// Use the DB storage in production, MemStorage in development as fallback
// File-based storage implementation for persistence
export class FileStorage implements IStorage {
  private users: Map<number, User>;
  private quizCollection: Map<number, Quiz>;
  private userCurrentId: number;
  private quizCurrentId: number;
  private readonly dataDir: string;
  private readonly usersFile: string;
  private readonly quizzesFile: string;
  private readonly counterFile: string;
  
  constructor() {
    // Initialize storage
    this.users = new Map<number, User>();
    this.quizCollection = new Map<number, Quiz>();
    this.userCurrentId = 1;
    this.quizCurrentId = 1;
    
    // Define file paths
    this.dataDir = path.join(process.cwd(), 'data');
    this.usersFile = path.join(this.dataDir, 'users.json');
    this.quizzesFile = path.join(this.dataDir, 'quizzes.json');
    this.counterFile = path.join(this.dataDir, 'counters.json');
    
    // Ensure data directory exists
    if (!fs.existsSync(this.dataDir)) {
      try {
        fs.mkdirSync(this.dataDir, { recursive: true });
        console.log(`Created data directory at ${this.dataDir}`);
      } catch (error) {
        console.error('Failed to create data directory:', error);
      }
    }
    
    // Load data from disk
    this.loadData();
  }
  
  // Helper methods for file operations
  private loadData(): void {
    try {
      // Load users
      if (fs.existsSync(this.usersFile)) {
        const userData = JSON.parse(fs.readFileSync(this.usersFile, 'utf8'));
        this.users = new Map(userData.map((user: User) => [user.id, user]));
        console.log(`Loaded ${this.users.size} users from file`);
      }
      
      // Load quizzes
      if (fs.existsSync(this.quizzesFile)) {
        const quizData = JSON.parse(fs.readFileSync(this.quizzesFile, 'utf8'));
        this.quizCollection = new Map(quizData.map((quiz: Quiz) => [quiz.id, quiz]));
        console.log(`Loaded ${this.quizCollection.size} quizzes from file`);
        
        // Ensure dates are Date objects
        for (const [id, quiz] of this.quizCollection.entries()) {
          if (quiz.createdAt && typeof quiz.createdAt === 'string') {
            quiz.createdAt = new Date(quiz.createdAt);
            this.quizCollection.set(id, quiz);
          }
        }
      }
      
      // Load counters
      if (fs.existsSync(this.counterFile)) {
        const counters = JSON.parse(fs.readFileSync(this.counterFile, 'utf8'));
        this.userCurrentId = counters.userCurrentId || 1;
        this.quizCurrentId = counters.quizCurrentId || 1;
        console.log(`Loaded counters: users=${this.userCurrentId}, quizzes=${this.quizCurrentId}`);
      }
    } catch (error) {
      console.error('Error loading data from disk:', error);
      // Initialize with empty collections if loading fails
      this.users = new Map();
      this.quizCollection = new Map();
    }
  }
  
  private saveUsers(): void {
    try {
      const usersArray = Array.from(this.users.values());
      fs.writeFileSync(this.usersFile, JSON.stringify(usersArray, null, 2), 'utf8');
      console.log(`Saved ${usersArray.length} users to disk`);
    } catch (error) {
      console.error('Error saving users to disk:', error);
    }
  }
  
  private saveQuizzes(): void {
    try {
      const quizzesArray = Array.from(this.quizCollection.values());
      fs.writeFileSync(this.quizzesFile, JSON.stringify(quizzesArray, null, 2), 'utf8');
      console.log(`Saved ${quizzesArray.length} quizzes to disk`);
    } catch (error) {
      console.error('Error saving quizzes to disk:', error);
    }
  }
  
  private saveCounters(): void {
    try {
      const counters = {
        userCurrentId: this.userCurrentId,
        quizCurrentId: this.quizCurrentId
      };
      fs.writeFileSync(this.counterFile, JSON.stringify(counters, null, 2), 'utf8');
    } catch (error) {
      console.error('Error saving counters to disk:', error);
    }
  }
  
  // User methods
  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }
  
  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }
  
  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.userCurrentId++;
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    
    // Save to disk
    this.saveUsers();
    this.saveCounters();
    
    return user;
  }
  
  // Quiz methods
  async getQuiz(id: number): Promise<Quiz | undefined> {
    return this.quizCollection.get(id);
  }
  
  async getQuizByUniqueId(uniqueId: string): Promise<Quiz | undefined> {
    return Array.from(this.quizCollection.values()).find(
      (quiz) => quiz.uniqueId === uniqueId
    );
  }
  
  async getAllQuizzes(): Promise<Quiz[]> {
    return Array.from(this.quizCollection.values());
  }
  
  async getPublicQuizzes(): Promise<Quiz[]> {
    return Array.from(this.quizCollection.values()).filter(
      (quiz) => quiz.isPublic === true
    );
  }
  
  async createQuiz(quiz: InsertQuiz): Promise<Quiz> {
    const id = this.quizCurrentId++;
    
    // Make sure uniqueId is set
    if (!quiz.uniqueId) {
      quiz.uniqueId = uuidv4();
    }
    
    // Make sure version is set
    const version = quiz.version || 1;
    
    // Set password to null if undefined
    const password = quiz.password === undefined ? null : quiz.password;
    
    // Cast to Quiz type to satisfy type constraints
    const newQuiz = {
      ...quiz,
      id,
      createdAt: quiz.createdAt || new Date(),
      version,
      password
    } as Quiz;
    
    this.quizCollection.set(id, newQuiz);
    
    // Save to disk
    this.saveQuizzes();
    this.saveCounters();
    
    return newQuiz;
  }
  
  async updateQuiz(id: number, quizUpdate: Partial<InsertQuiz>): Promise<Quiz | undefined> {
    const existingQuiz = this.quizCollection.get(id);
    
    if (!existingQuiz) {
      return undefined;
    }
    
    const updatedQuiz: Quiz = { 
      ...existingQuiz, 
      ...quizUpdate,
      version: existingQuiz.version ? existingQuiz.version + 1 : 1
    };
    
    this.quizCollection.set(id, updatedQuiz);
    
    // Save to disk
    this.saveQuizzes();
    
    return updatedQuiz;
  }
  
  async deleteQuiz(id: number): Promise<boolean> {
    const deleted = this.quizCollection.delete(id);
    
    // If deleted successfully, save changes
    if (deleted) {
      this.saveQuizzes();
    }
    
    return deleted;
  }
  
  // Clean up private quizzes to save server storage
  async deletePrivateQuizzes(): Promise<number> {
    let count = 0;
    
    // Get all quizzes that are private
    const privateQuizzes = Array.from(this.quizCollection.values())
      .filter(quiz => !quiz.isPublic);
    
    // Delete each private quiz
    for (const quiz of privateQuizzes) {
      if (this.quizCollection.delete(quiz.id)) {
        count++;
      }
    }
    
    if (count > 0) {
      console.log(`Deleted ${count} private quizzes to save server storage`);
      this.saveQuizzes();
    }
    
    return count;
  }
  
  // Helper function to create a content hash for quiz comparison
  private createContentHash(quiz: Quiz): string {
    // Create a simplified representation for comparison
    const titleNormalized = quiz.title.toLowerCase().trim();
    
    // Only include essential question data if available
    const questionsData = quiz.questions ? quiz.questions.map(q => ({
      question: typeof q.question === 'string' ? q.question.toLowerCase().trim() : '',
      options: Array.isArray(q.options) 
        ? q.options.map(opt => typeof opt === 'string' ? opt.toLowerCase().trim() : '').sort().join('|')
        : '',
      correctAnswer: typeof q.correctAnswer === 'string' ? q.correctAnswer.toLowerCase().trim() : ''
    })) : [];
    
    // Sort questions for consistent comparison
    if (questionsData.length > 0) {
      questionsData.sort((a, b) => a.question.localeCompare(b.question));
    }
    
    // Create a hash
    return `${titleNormalized}:${questionsData.length}:${JSON.stringify(questionsData)}`;
  }
  
  // Method to identify and remove duplicate quizzes
  async removeDuplicateQuizzes(): Promise<number> {
    console.log("Running server-side duplicate quiz detection...");
    
    // Track performance
    const startTime = performance.now();
    
    // Get all quizzes
    const allQuizzes = Array.from(this.quizCollection.values());
    
    if (allQuizzes.length <= 1) {
      console.log("No duplicates possible with 0 or 1 quizzes");
      return 0;
    }
    
    // Map to track quizzes with same title for content comparison
    const titleMap = new Map<string, Quiz[]>();
    
    // Maps to track uniqueness
    const uniqueIdMap = new Map<string, Quiz>();  // For uniqueId tracking
    const contentHashMap = new Map<string, Quiz>(); // For content similarity tracking
    const quizzesToKeep = new Set<number>();      // IDs to keep
    const duplicatesToRemove: Quiz[] = [];        // Quizzes to remove
    
    // First pass - identify duplicates by content hash (most reliable)
    for (const quiz of allQuizzes) {
      // Create content hash for comparison
      const contentHash = this.createContentHash(quiz);
      
      if (!contentHashMap.has(contentHash)) {
        // First occurrence of this content hash
        contentHashMap.set(contentHash, quiz);
        quizzesToKeep.add(quiz.id);
      } else {
        const existingQuiz = contentHashMap.get(contentHash)!;
        
        // Skip if comparing to self
        if (quiz.id === existingQuiz.id) {
          continue;
        }
        
        console.log(`Found duplicate content: "${quiz.title}" and "${existingQuiz.title}"`);
        
        // Determine which to keep based on version or creation date
        const keepNew = (quiz.version && existingQuiz.version && quiz.version > existingQuiz.version) ||
          (quiz.createdAt && existingQuiz.createdAt && 
           new Date(quiz.createdAt).getTime() > new Date(existingQuiz.createdAt).getTime());
        
        if (keepNew) {
          // Replace the existing quiz with the newer one
          quizzesToKeep.delete(existingQuiz.id);
          quizzesToKeep.add(quiz.id);
          contentHashMap.set(contentHash, quiz);
          duplicatesToRemove.push(existingQuiz);
          console.log(`Keeping newer quiz: "${quiz.title}" (ID: ${quiz.id}, v:${quiz.version})`);
        } else {
          // Current quiz is older
          duplicatesToRemove.push(quiz);
          console.log(`Keeping newer quiz: "${existingQuiz.title}" (ID: ${existingQuiz.id}, v:${existingQuiz.version})`);
        }
      }
    }
    
    // Second pass - check for quizzes with same uniqueId but different content
    uniqueIdMap.clear(); // Reset map for second pass
    
    for (const quiz of allQuizzes) {
      // Skip if already removed as duplicate
      if (!quizzesToKeep.has(quiz.id) || !quiz.uniqueId) continue;
      
      if (!uniqueIdMap.has(quiz.uniqueId)) {
        // First occurrence of this uniqueId
        uniqueIdMap.set(quiz.uniqueId, quiz);
      } else {
        // We found duplicate uniqueId but different content hash
        const existingQuiz = uniqueIdMap.get(quiz.uniqueId)!;
        
        // Skip if comparing to self
        if (quiz.id === existingQuiz.id) continue;
        
        console.log(`Found duplicate uniqueId: ${quiz.uniqueId} between "${quiz.title}" and "${existingQuiz.title}"`);
        
        // Determine which to keep based on version or creation date
        const keepNew = (quiz.version && existingQuiz.version && quiz.version > existingQuiz.version) ||
          (quiz.createdAt && existingQuiz.createdAt && 
           new Date(quiz.createdAt).getTime() > new Date(existingQuiz.createdAt).getTime());
        
        if (keepNew) {
          // Keep the newer quiz
          quizzesToKeep.delete(existingQuiz.id);
          uniqueIdMap.set(quiz.uniqueId, quiz);
          duplicatesToRemove.push(existingQuiz);
          console.log(`Keeping newer quiz: "${quiz.title}" (ID: ${quiz.id}, v:${quiz.version})`);
        } else {
          // Keep the existing quiz
          quizzesToKeep.delete(quiz.id);
          duplicatesToRemove.push(quiz);
          console.log(`Keeping newer quiz: "${existingQuiz.title}" (ID: ${existingQuiz.id}, v:${existingQuiz.version})`);
        }
      }
    }
    
    // Third pass - check for quizzes with the same title but different uniqueIds
    // This helps catch duplicates that might have been missed in previous passes
    titleMap.clear();
    
    for (const quiz of allQuizzes) {
      // Skip if already marked as duplicate
      if (!quizzesToKeep.has(quiz.id)) continue;
      
      const normalizedTitle = quiz.title.toLowerCase().trim();
      
      if (!titleMap.has(normalizedTitle)) {
        titleMap.set(normalizedTitle, [quiz]);
      } else {
        titleMap.get(normalizedTitle)!.push(quiz);
      }
    }
    
    // Check each title group for potential duplicates
    for (const [title, quizzesWithSameTitle] of titleMap.entries()) {
      if (quizzesWithSameTitle.length > 1) {
        console.log(`Found ${quizzesWithSameTitle.length} quizzes with title "${title}" - checking for similarity`);
        
        // Compare each quiz with others having the same title
        for (let i = 0; i < quizzesWithSameTitle.length; i++) {
          const quiz1 = quizzesWithSameTitle[i];
          
          // Skip if already removed as duplicate
          if (!quizzesToKeep.has(quiz1.id)) continue;
          
          for (let j = i + 1; j < quizzesWithSameTitle.length; j++) {
            const quiz2 = quizzesWithSameTitle[j];
            
            // Skip if already removed as duplicate
            if (!quizzesToKeep.has(quiz2.id)) continue;
            
            // Compare questions for similarity
            if (quiz1.questions && quiz2.questions) {
              // Skip if they have a significantly different number of questions
              if (Math.abs(quiz1.questions.length - quiz2.questions.length) > 1) {
                continue;
              }
              
              let matchCount = 0;
              
              // Count matching questions
              for (const q1 of quiz1.questions) {
                for (const q2 of quiz2.questions) {
                  if (
                    q1.question.toLowerCase().trim() === q2.question.toLowerCase().trim() ||
                    q1.correctAnswer.toLowerCase().trim() === q2.correctAnswer.toLowerCase().trim()
                  ) {
                    matchCount++;
                    break;
                  }
                }
              }
              
              // If 80% or more questions match, consider them duplicates
              const threshold = Math.min(quiz1.questions.length, quiz2.questions.length) * 0.8;
              if (matchCount >= threshold) {
                console.log(`Found similar quizzes with title "${title}" - ${matchCount} matching questions`);
                
                // Check version strings before comparing
                let quiz1Version = typeof quiz1.version === 'number' ? quiz1.version : 0;
                let quiz2Version = typeof quiz2.version === 'number' ? quiz2.version : 0;
                
                // Keep the newer quiz
                const keepQuiz1 = (quiz1Version > quiz2Version) ||
                  (quiz1.createdAt && quiz2.createdAt && 
                   new Date(quiz1.createdAt).getTime() > new Date(quiz2.createdAt).getTime());
                
                if (keepQuiz1) {
                  quizzesToKeep.delete(quiz2.id);
                  duplicatesToRemove.push(quiz2);
                  console.log(`Keeping newer quiz: "${quiz1.title}" (ID: ${quiz1.id}, v:${quiz1.version})`);
                } else {
                  quizzesToKeep.delete(quiz1.id);
                  duplicatesToRemove.push(quiz1);
                  console.log(`Keeping newer quiz: "${quiz2.title}" (ID: ${quiz2.id}, v:${quiz2.version})`);
                  break; // Break inner loop since quiz1 was removed
                }
              }
            }
          }
        }
      }
    }
    
    // Delete all identified duplicates
    let deleteCount = 0;
    for (const quiz of duplicatesToRemove) {
      console.log(`Removing duplicate quiz: "${quiz.title}" (ID: ${quiz.id}, uniqueId: ${quiz.uniqueId || 'none'})`);
      if (this.quizCollection.delete(quiz.id)) {
        deleteCount++;
      }
    }
    
    // Save changes if we deleted anything
    if (deleteCount > 0) {
      this.saveQuizzes();
    }
    
    // Log results
    const endTime = performance.now();
    console.log(`Removed ${deleteCount} duplicate quizzes in ${(endTime - startTime).toFixed(2)}ms`);
    
    return deleteCount;
  }
  
  async syncQuizzes(quizzesToSync: InsertQuiz[]): Promise<Quiz[]> {
    // Filter out quizzes that are explicitly private - don't store them on the server at all
    const publicQuizzesToSync = quizzesToSync.filter(quiz => quiz.isPublic === true);
    console.log(`Processing ${publicQuizzesToSync.length} public quizzes out of ${quizzesToSync.length} total quizzes`);
    
    let changesMade = false; // Track if we need to save changes
    
    // Process ONLY PUBLIC quizzes - private quizzes stay only on client
    for (const quizToSync of publicQuizzesToSync) {
      // Skip quizzes without a uniqueId
      if (!quizToSync.uniqueId) {
        console.log("Skipping quiz without uniqueId");
        continue;
      }
      
      // Check if quiz already exists by uniqueId
      const existingQuiz = await this.getQuizByUniqueId(quizToSync.uniqueId);
      
      if (existingQuiz) {
        // Update the existing quiz
        console.log(`Updating existing public quiz: ${quizToSync.title} (uniqueId: ${quizToSync.uniqueId})`);
        await this.updateQuiz(existingQuiz.id, quizToSync);
        changesMade = true;
      } else {
        // Create new quiz
        console.log(`Creating new public quiz: ${quizToSync.title} (uniqueId: ${quizToSync.uniqueId})`);
        await this.createQuiz(quizToSync);
        changesMade = true; // Note: createQuiz already saves to disk
      }
    }
    
    // For any quiz that exists on server but is now private on client, delete it from server
    for (const quizToSync of quizzesToSync) {
      if (!quizToSync.isPublic && quizToSync.uniqueId) {
        const existingQuiz = await this.getQuizByUniqueId(quizToSync.uniqueId);
        if (existingQuiz) {
          console.log(`Quiz ${quizToSync.title} is now private - removing from server`);
          await this.deleteQuiz(existingQuiz.id);
          changesMade = true; // Note: deleteQuiz already saves to disk
        }
      }
    }
    
    // Clean up storage by removing any private quizzes
    await this.deletePrivateQuizzes();
    
    // Run duplicate detection
    await this.removeDuplicateQuizzes();
    
    // Return only public quizzes
    return await this.getPublicQuizzes();
  }
}

// Use the file-based storage for persistence
export const storage = new FileStorage();