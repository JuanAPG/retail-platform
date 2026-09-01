# Plataforma de Análisis de Ingreso y Patrones de Consumo Minorista

Sistema web + microservicios + app móvil + app de escritorio para analizar
canastas de consumo por zona, ingreso y precio.

## Stack
Node.js/NestJS · Python/FastAPI · React · Kotlin · Electron ·
PostgreSQL · MongoDB · Redis · Docker · GCP

## Cómo levantar el entorno local
1. Instalar Docker Desktop
2. `cd infra && docker compose up -d`
3. Web: http://localhost:5173 · API: http://localhost:3000
   pgAdmin: http://localhost:5050 · mongo-express: http://localhost:8081

## Estructura del repo
retail-platform/
├── api/                # Backend (NestJS) — monolito en Sprint 0
├── web/                # Frontend (React/Vite)
├── mobile/              # App Android — se agrega en Parcial 2
├── desktop/             # App de escritorio — se agrega en Parcial 2
├── services/            # Microservicios independientes — se agregan en Parcial 2
├── infra/
│   └── docker-compose.yml
├── docs/
│   ├── analisis-problema.md
│   ├── requerimientos.md
│   ├── historias-usuario.md
│   ├── reglas-negocio.md
│   ├── matriz-perfiles-permisos.docx
│   ├── arquitectura/         (diagramas C4)
│   └── modelo-datos/         (ER Postgres, diseño Mongo/Redis)
├── .gitignore
├── README.md
└── CONTRIBUTING.md

## Equipo
Juan Angel Galván Navarro — Arquitectura / DevOps
Leonardo Rangel Castro — Backend Web
Pamela Rodríguez de la Rosa — Datos / Algoritmos
Fernando Olivares del Valle — Apps cliente

