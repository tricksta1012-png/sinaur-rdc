/**
 * Tâches de coordination inter-agences — kanban par crise.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sql } from '../db.js'
import { requireAuth, requireRole, writeAuditLog } from '../auth/jwt.js'
import { broadcast } from '../websocket/broadcast.js'

const CreateTaskSchema = z.object({
  title:       z.string().min(2).max(300),
  description: z.string().max(1000).optional(),
  priority:    z.number().int().min(0).max(2).default(0),
  assignedTo:  z.string().uuid().optional(),
  agency:      z.string().max(200).optional(),
  dueDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

const UpdateTaskSchema = z.object({
  title:       z.string().min(2).max(300).optional(),
  description: z.string().max(1000).optional(),
  status:      z.enum(['todo', 'in_progress', 'blocked', 'done']).optional(),
  priority:    z.number().int().min(0).max(2).optional(),
  assignedTo:  z.string().uuid().nullable().optional(),
  agency:      z.string().max(200).optional(),
  dueDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
})

export async function taskRoutes(fastify: FastifyInstance) {

  fastify.get('/crises/:crisisId/tasks', {
    preHandler: [requireAuth, requireRole('system_admin', 'national_decision_maker', 'territory_admin', 'humanitarian_partner')],
  }, async (request) => {
    const { crisisId } = request.params as { crisisId: string }

    const rows = await sql`
      SELECT t.*, u.full_name AS assignee_name, u.email AS assignee_email
      FROM coordination_tasks t
      LEFT JOIN users u ON u.id = t.assigned_to
      WHERE t.crisis_event_id = ${crisisId}
      ORDER BY t.priority DESC, t.created_at ASC
    `
    return { success: true, data: rows }
  })

  fastify.post('/crises/:crisisId/tasks', {
    preHandler: [requireAuth, requireRole('system_admin', 'national_decision_maker', 'territory_admin', 'humanitarian_partner')],
  }, async (request, reply) => {
    const user = request.jwtUser
    const { crisisId } = request.params as { crisisId: string }
    const body = CreateTaskSchema.parse(request.body)

    const [task] = await sql`
      INSERT INTO coordination_tasks (
        crisis_event_id, title, description, priority,
        assigned_to, agency, due_date, created_by
      ) VALUES (
        ${crisisId},
        ${body.title},
        ${body.description ?? null},
        ${body.priority},
        ${body.assignedTo ?? null},
        ${body.agency ?? null},
        ${body.dueDate ?? null}::date,
        ${user.sub}
      )
      RETURNING *
    `

    await writeAuditLog(user.sub, 'create', 'coordination_tasks', task.id, request, { crisisId })
    broadcast({ type: 'TASK_CREATED', payload: { crisisId, task } } as any)

    return reply.status(201).send({ success: true, data: task })
  })

  fastify.patch('/tasks/:id', {
    preHandler: [requireAuth, requireRole('system_admin', 'national_decision_maker', 'territory_admin', 'humanitarian_partner')],
  }, async (request, reply) => {
    const user = request.jwtUser
    const { id } = request.params as { id: string }
    const body = UpdateTaskSchema.parse(request.body)

    const [task] = await sql`
      UPDATE coordination_tasks SET
        title       = COALESCE(${body.title ?? null},       title),
        description = COALESCE(${body.description ?? null}, description),
        status      = COALESCE(${body.status ?? null},      status),
        priority    = COALESCE(${body.priority ?? null},    priority),
        assigned_to = CASE WHEN ${body.assignedTo !== undefined} THEN ${body.assignedTo ?? null} ELSE assigned_to END,
        agency      = COALESCE(${body.agency ?? null},      agency),
        due_date    = CASE WHEN ${body.dueDate !== undefined} THEN ${body.dueDate ?? null}::date ELSE due_date END
      WHERE id = ${id}
      RETURNING *
    `
    if (!task) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND' } })

    await writeAuditLog(user.sub, 'update', 'coordination_tasks', id, request, body)
    broadcast({ type: 'TASK_UPDATED', payload: { id, status: task.status, crisisEventId: task.crisisEventId } } as any)

    return { success: true, data: task }
  })

  fastify.delete('/tasks/:id', {
    preHandler: [requireAuth, requireRole('system_admin', 'national_decision_maker', 'territory_admin')],
  }, async (request, reply) => {
    const user = request.jwtUser
    const { id } = request.params as { id: string }

    const [task] = await sql`DELETE FROM coordination_tasks WHERE id = ${id} RETURNING id, crisis_event_id`
    if (!task) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND' } })

    await writeAuditLog(user.sub, 'delete', 'coordination_tasks', id, request, {})
    return { success: true }
  })
}
