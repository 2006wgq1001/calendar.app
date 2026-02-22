from flask import Flask, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

@app.route('/api/test')
def test():
    print("✅ 收到前端请求！")
    return jsonify({"message": "连接成功", "status": "ok"})

if __name__ == '__main__':
    print("🚀 后端启动在 http://localhost:5000")
    app.run(port=5000, debug=True)