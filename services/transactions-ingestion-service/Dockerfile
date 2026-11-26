FROM node:20-alpine AS build
WORKDIR /app
COPY services/transactions-ingestion-service/package*.json ./
RUN npm ci
COPY services/transactions-ingestion-service/src ./src
COPY services/transactions-ingestion-service/*.json ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache libxml2-utils
ENV NODE_ENV=production PORT=3111 SERVICE_NAME=transactions-ingestion-service XML_NAMESPACE=ingestion/v1
ENV INGESTION_XSD=/app/contracts/transactions-ingestion-service.xsd
COPY services/transactions-ingestion-service/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY docs/contratos/transactions-ingestion-service.xsd ./contracts/
COPY docs/contratos/xsd/error-transversal.xsd ./contracts/xsd/
USER node
EXPOSE 3111
CMD ["node", "dist/main.js"]
