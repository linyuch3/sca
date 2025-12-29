#!/bin/bash
# 更新部署脚本

echo "🔄 停止旧容器..."
docker-compose -f docker-compose.custom.yml down

echo "📥 拉取最新镜像..."
docker pull ghcr.io/7d653179z/sca:latest

echo "🚀 启动新容器..."
docker-compose -f docker-compose.custom.yml up -d

echo "✅ 部署完成！"
echo ""
echo "查看日志: docker-compose -f docker-compose.custom.yml logs -f moontv-core"
echo "访问地址: http://localhost:3000"
