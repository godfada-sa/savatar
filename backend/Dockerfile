FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY signaling.js ./

ENV NODE_ENV=production
EXPOSE 4000
CMD ["npm", "start"]
