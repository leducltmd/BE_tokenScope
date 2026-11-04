import type { NextFunction, Request, Response } from 'express';

import * as projectsService from './projects.service';

/** GET /api/projects — Danh sách dự án kèm số liệu usage thật. */
export async function list(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const overview = await projectsService.listProjects(req.user!.id);
    res.status(200).json(overview);
  } catch (error) {
    next(error);
  }
}

/** GET /api/projects/:id — Chi tiết một dự án. */
export async function detail(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const project = await projectsService.getProject(req.user!.id, req.params.id);
    res.status(200).json({ project });
  } catch (error) {
    next(error);
  }
}
