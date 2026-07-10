import { config } from './config.js'
import { createApp } from './app.js'

const fastify = await createApp()

try {
  await fastify.listen({ port: config.PORT ?? config.API_PORT, host: config.API_HOST })
  fastify.log.info(`SINAUR-RDC API v0.8.0-phase8 — http://${config.API_HOST}:${config.API_PORT}`)
} catch (err) {
  fastify.log.error(err)
  process.exit(1)
}
