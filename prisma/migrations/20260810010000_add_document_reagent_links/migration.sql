-- 一张票据文件只保存一次，通过关联表连接同一票据中的多个入库试剂。
CREATE TABLE "DocumentReagent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "reagentId" TEXT NOT NULL,
    "itemIndex" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentReagent_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DocumentReagent_reagentId_fkey" FOREIGN KEY ("reagentId") REFERENCES "Reagent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "DocumentReagent_documentId_itemIndex_key" ON "DocumentReagent"("documentId", "itemIndex");
CREATE UNIQUE INDEX "DocumentReagent_documentId_reagentId_key" ON "DocumentReagent"("documentId", "reagentId");
CREATE INDEX "DocumentReagent_reagentId_idx" ON "DocumentReagent"("reagentId");

-- 兼容本功能上线前已经确认的多条 OCR 结果：从 recognitionResult.items 回填关联。
INSERT OR IGNORE INTO "DocumentReagent" ("id", "documentId", "reagentId", "itemIndex", "createdAt")
SELECT
    lower(hex(randomblob(16))),
    d."id",
    json_extract(item.value, '$.reagentId'),
    CAST(item.key AS INTEGER),
    CURRENT_TIMESTAMP
FROM "Document" AS d, json_each(d."recognitionResult", '$.items') AS item
WHERE json_valid(d."recognitionResult")
  AND json_extract(item.value, '$.confirmationStatus') = 'CONFIRMED'
  AND json_extract(item.value, '$.reagentId') IS NOT NULL;
