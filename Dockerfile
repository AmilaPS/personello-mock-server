FROM node:20-slim

# SQLite3 Build කිරීමට අවශ්‍ය Python සහ C++ Tools Install කිරීම
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "start"]