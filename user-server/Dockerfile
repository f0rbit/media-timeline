FROM node:14

WORKDIR /app

COPY package*.json ./
RUN npm install
RUN npm install -g prisma

COPY . .

RUN npm run build

CMD [ "sh", "-c", "prisma migrate deploy && npm run serve" ]