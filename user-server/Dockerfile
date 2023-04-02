# Use the official Deno image as the base
FROM denoland/deno:latest

# Set the working directory
WORKDIR /app

# Copy the dependencies file
COPY src/deps.ts src/

# Cache the dependencies
RUN deno cache src/deps.ts

# Copy the source files
COPY src/ ./src/

# Expose the server port
EXPOSE 3000

# Start the Deno server
CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-env", "src/server.ts"]
