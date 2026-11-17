# Esqueleto de Dockerfile para microservicios NestJS — NO CAMBIAR su estructura.
# Multi-stage: se compila en `build` y se corre solo `dist` + deps de
# producción. El puerto sale de `PORT` (lo fija docker-compose por
# servicio); EXPOSE documenta el default de la plantilla.
#
# `npm ci` y no `npm install`: el package-lock.json está versionado, así
# que la imagen se construye con las versiones exactas que se probaron.
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# No correr como root: la imagen de node ya trae el usuario `node`.
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
