# Esqueleto de Dockerfile para microservicios NestJS — NO CAMBIAR su estructura.
# Multi-stage: se compila en `build` y se corre solo `dist` + deps de
# producción. El puerto sale de `PORT` (lo fija docker-compose por
# servicio); EXPOSE documenta el default de la plantilla.
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main.js"]
