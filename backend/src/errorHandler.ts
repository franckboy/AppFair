import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { Prisma } from "./generated/prisma/client.js";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "Invalid request", issues: err.issues });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (err.code === "P2003") {
      res.status(400).json({ error: "Invalid reference: related record does not exist" });
      return;
    }
  }

  console.error(err);
  res.status(500).json({ error: "Internal server error" });
}
