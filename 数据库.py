import sqlite3

# 脚本用于展示事件及其所属用户的信息
conn = sqlite3.connect('backend/database.db')
cur = conn.cursor()

# 如果只需要查看所有事件和用户，可以使用 JOIN 查询
query = '''
SELECT e.id,
       u.id AS user_id,
       u.username,
       u.name,
       u.email,
       e.title,
       e.description,
       e.start_date,
       e.end_date,
       e.start_time,
       e.end_time,
       e.color
FROM event e
JOIN user u ON e.user_id = u.id
ORDER BY e.id;
'''

print("id | user_id | username | name | email | title | description | start_date | end_date | start_time | end_time | color")
for row in cur.execute(query):
    print(row)

conn.close()