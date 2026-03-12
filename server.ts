import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const db = new Database(":memory:");

// Initialize marketing table with sample data if needed, 
// but we'll primarily support CSV upload as requested.
db.exec(`
  CREATE TABLE IF NOT EXISTS marketing_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    "Campaign" TEXT,
    "Channel" TEXT,
    "Impressions" INTEGER,
    "Clicks" INTEGER,
    "CTR" REAL,
    "CPC" REAL,
    "Spend" REAL,
    "Conversions" INTEGER,
    "Revenue" REAL,
    "Date" TEXT
  )
`);

// Insert sample data if table is empty
const rowCount = db.prepare("SELECT COUNT(*) as count FROM marketing_data").get() as { count: number };
if (rowCount.count === 0) {
  const insert = db.prepare(`
    INSERT INTO marketing_data ("Campaign", "Channel", "Impressions", "Clicks", "CTR", "CPC", "Spend", "Conversions", "Revenue", "Date")
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const sampleData = [
    ['Summer Sale', 'Google Ads', 50000, 2500, 0.05, 0.80, 2000, 120, 8500, '2024-06-01'],
    ['Summer Sale', 'Facebook', 45000, 3000, 0.06, 0.50, 1500, 150, 7200, '2024-06-01'],
    ['Winter Clearance', 'Google Ads', 60000, 1800, 0.03, 1.10, 1980, 80, 6000, '2024-12-01'],
    ['Winter Clearance', 'Instagram', 55000, 4000, 0.07, 0.30, 1200, 200, 9500, '2024-12-01'],
    ['Brand Awareness', 'LinkedIn', 20000, 400, 0.02, 2.50, 1000, 10, 1500, '2024-03-15'],
    ['Brand Awareness', 'Google Ads', 30000, 900, 0.03, 1.20, 1080, 25, 3000, '2024-03-15'],
    ['Flash Sale', 'Email', 10000, 1500, 0.15, 0.05, 75, 300, 12000, '2024-05-20'],
    ['Flash Sale', 'SMS', 5000, 1000, 0.20, 0.10, 100, 150, 5000, '2024-05-20']
  ];

  const insertMany = db.transaction((data) => {
    for (const row of data) insert.run(row);
  });
  insertMany(sampleData);
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '100mb' }));
  
  // Request logger
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });
  
  // JSON body parser error handler
  app.use((err: any, req: any, res: any, next: any) => {
    if (err instanceof SyntaxError && 'status' in err && err.status === 400 && 'body' in err) {
      return res.status(400).json({ error: "Invalid JSON payload" });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: "The file is too large. Please upload a smaller dataset." });
    }
    next(err);
  });

  // API Routes
  app.post("/api/upload", (req, res) => {
    console.log("Upload request received. Body size:", JSON.stringify(req.body).length);
    const { data } = req.body; // Array of objects
    if (!Array.isArray(data) || data.length === 0) {
      console.log("Invalid upload data format");
      return res.status(400).json({ error: "Invalid data format or empty file." });
    }
    console.log(`Processing ${data.length} rows...`);

    try {
      // Get unique columns and filter out empty ones
      const rawColumns = Object.keys(data[0]).filter(col => col.trim() !== "");
      
      if (rawColumns.length === 0) {
        throw new Error("No valid columns found in CSV.");
      }

      if (rawColumns.length > 900) {
        throw new Error("The dataset has too many columns (limit is 900). Please reduce the number of columns and try again.");
      }

      // Create mapping for safe SQL names to avoid collisions and invalid characters
      const columnMapping = rawColumns.map((col, index) => ({
        original: col,
        safe: `col_${index}_${col.replace(/[^a-zA-Z0-9]/g, '_')}`.substring(0, 60)
      }));

      // Drop and recreate table dynamically based on CSV headers
      db.prepare("DROP TABLE IF EXISTS marketing_data").run();
      
      const columnDefs = columnMapping.map(m => {
        const firstVal = data[0][m.original];
        let type = "TEXT";
        if (typeof firstVal === "number") {
          type = Number.isInteger(firstVal) ? "INTEGER" : "REAL";
        }
        return `"${m.original}" ${type}`; // Using original names in quotes for the table
      }).join(", ");

      db.prepare(`CREATE TABLE marketing_data (${columnDefs})`).run();

      const quotedColumns = columnMapping.map(m => `"${m.original}"`).join(",");
      const namedPlaceholders = columnMapping.map(m => `@${m.safe}`).join(",");
      const insert = db.prepare(`INSERT INTO marketing_data (${quotedColumns}) VALUES (${namedPlaceholders})`);

      const insertMany = db.transaction((rows) => {
        for (const row of rows) {
          const bindData: any = {};
          for (const m of columnMapping) {
            let val = row[m.original];
            
            // Clean numeric strings (handle currency, commas)
            if (typeof val === 'string') {
              const cleaned = val.replace(/[$,]/g, '').trim();
              if (cleaned !== '' && !isNaN(Number(cleaned))) {
                val = Number(cleaned);
              }
            }
            
            // Ensure value is a primitive SQLite can handle
            if (val === undefined || val === null) {
              val = null;
            } else if (typeof val === 'object') {
              // Handle Dates or other objects by stringifying them
              if (val instanceof Date) {
                val = val.toISOString();
              } else {
                val = JSON.stringify(val);
              }
            } else if (typeof val === 'boolean') {
              val = val ? 1 : 0;
            }
            
            bindData[m.safe] = val;
          }
          insert.run(bindData);
        }
      });

      insertMany(data);
      res.json({ success: true, count: data.length, columns: rawColumns });
    } catch (error: any) {
      console.error("Upload error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/query", (req, res) => {
    const { sql } = req.body;
    if (!sql) {
      return res.status(400).json({ error: "No SQL query provided." });
    }
    try {
      const results = db.prepare(sql).all();
      if (results.length === 0) {
        return res.json({ results: [], message: "No data found matching your request." });
      }
      res.json({ results });
    } catch (error: any) {
      console.error("Query error:", error);
      // Provide more user-friendly error messages for common SQL issues
      let userMessage = "I encountered an issue executing the data query.";
      if (error.message.includes("no such column")) {
        userMessage = `The query failed because it referenced a column that doesn't exist: ${error.message.split(":").pop()?.trim()}`;
      } else if (error.message.includes("syntax error")) {
        userMessage = "The AI generated an invalid query. Please try rephrasing your question.";
      }
      res.status(500).json({ error: userMessage, details: error.message });
    }
  });

  app.get("/api/schema", (req, res) => {
    try {
      const info = db.prepare("PRAGMA table_info(marketing_data)").all();
      res.json({ schema: info });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/clear", (req, res) => {
    try {
      db.prepare("DROP TABLE IF EXISTS marketing_data").run();
      // Recreate empty table with default schema just to avoid errors
      db.exec(`
        CREATE TABLE IF NOT EXISTS marketing_data (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          "Campaign" TEXT,
          "Channel" TEXT,
          "Impressions" INTEGER,
          "Clicks" INTEGER,
          "CTR" REAL,
          "CPC" REAL,
          "Spend" REAL,
          "Conversions" INTEGER,
          "Revenue" REAL,
          "Date" TEXT
        )
      `);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Final API error handler
  app.use('/api', (err: any, req: any, res: any, next: any) => {
    console.error("API Error:", err);
    res.status(err.status || 500).json({ error: err.message || "Internal server error" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
    app.get("*", (req, res) => {
      res.sendFile(path.resolve("dist/index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
