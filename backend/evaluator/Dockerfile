# Readiness evaluator (Jev). Its own Railway service: it is Node, while the API image is
# Python, and onboarding can never report ready without it.
#
# Build context is backend/:  docker build -f evaluator/Dockerfile backend
FROM node:22-slim
WORKDIR /app
COPY evaluator/package.json evaluator/package-lock.json ./
RUN npm ci --omit=dev
COPY evaluator/ ./
# Railway routes to $PORT and reaches the service over its private network, so bind wide.
ENV EVALUATOR_HOST=0.0.0.0
EXPOSE 8001
CMD ["node", "server.mjs"]
