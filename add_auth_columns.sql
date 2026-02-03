-- 为 owners 表添加 email 和 password 列
ALTER TABLE owners ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE owners ADD COLUMN IF NOT EXISTS password TEXT DEFAULT '123456';

-- 更新现有用户的 email
UPDATE owners SET email = 'leochanguang@gmail.com', password = '123456' WHERE owner_id = '1';
UPDATE owners SET email = 'admin@buiservice', password = '123456' WHERE owner_id = '2';

-- 为 email 创建唯一索引
CREATE UNIQUE INDEX IF NOT EXISTS idx_owners_email ON owners(email);
