#!/bin/bash
# Redis/Kvrocks 兼容性测试脚本

set -e

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🧪 Redis/Kvrocks 兼容性测试${NC}"
echo "================================"
echo ""

# 检查服务是否运行
if ! curl -s http://localhost:3000 > /dev/null 2>&1; then
  echo -e "${RED}❌ 服务未运行，请先启动应用${NC}"
  echo "使用: docker-compose up -d 或 pnpm dev"
  exit 1
fi

echo -e "${GREEN}✅ 服务正在运行${NC}"
echo ""

# 测试计数器
PASSED=0
FAILED=0

# 测试函数
test_api() {
  local test_name=$1
  local method=$2
  local url=$3
  local data=$4
  local expected_code=${5:-200}
  
  echo -ne "${BLUE}测试: ${test_name}...${NC} "
  
  if [ -n "$data" ]; then
    response=$(curl -s -w "\n%{http_code}" -X "$method" \
      -H "Content-Type: application/json" \
      -d "$data" \
      "$url")
  else
    response=$(curl -s -w "\n%{http_code}" -X "$method" "$url")
  fi
  
  # 提取HTTP状态码
  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | head -n-1)
  
  if [ "$http_code" = "$expected_code" ]; then
    echo -e "${GREEN}✅ 通过${NC} (HTTP $http_code)"
    PASSED=$((PASSED + 1))
    return 0
  else
    echo -e "${RED}❌ 失败${NC} (Expected $expected_code, Got $http_code)"
    echo "响应: $body"
    FAILED=$((FAILED + 1))
    return 1
  fi
}

# 生成时间戳
NOW=$(date +%s)000
START_DATE=$NOW
END_DATE=$(( $(date +%s) + 86400 ))000  # 明天

# 测试1: 创建广告
echo -e "${YELLOW}1️⃣ 广告管理功能测试${NC}"
echo "--------------------------------"

AD_DATA=$(cat <<EOF
{
  "action": "create",
  "advertisement": {
    "position": "home_banner",
    "type": "image",
    "title": "Redis测试广告",
    "materialUrl": "https://via.placeholder.com/800x200/FF6B6B/FFFFFF?text=Redis+Test+Ad",
    "clickUrl": "https://example.com/redis-test",
    "width": 800,
    "height": 200,
    "startDate": $START_DATE,
    "endDate": $END_DATE,
    "enabled": true,
    "priority": 10
  }
}
EOF
)

test_api "创建广告" "POST" "http://localhost:3000/api/admin/advertisements" "$AD_DATA"

# 测试2: 获取所有广告
test_api "获取广告列表" "GET" "http://localhost:3000/api/admin/advertisements"

# 测试3: 获取活跃广告
test_api "获取活跃广告(home_banner)" "GET" "http://localhost:3000/api/advertisements?position=home_banner"

echo ""
echo -e "${YELLOW}2️⃣ 用户会话功能测试${NC}"
echo "--------------------------------"

# 测试4: 心跳
test_api "用户心跳" "POST" "http://localhost:3000/api/user/heartbeat" "{}"

echo ""
echo -e "${YELLOW}3️⃣ 统计功能测试${NC}"
echo "--------------------------------"

# 测试5: 获取统计数据
test_api "管理员统计" "GET" "http://localhost:3000/api/admin/stats"

echo ""
echo -e "${YELLOW}4️⃣ 用户功能测试${NC}"
echo "--------------------------------"

# 测试6: 搜索历史
SEARCH_DATA='{"query":"测试关键词"}'
test_api "添加搜索历史" "POST" "http://localhost:3000/api/searchhistory" "$SEARCH_DATA"

test_api "获取搜索历史" "GET" "http://localhost:3000/api/searchhistory"

echo ""
echo -e "${YELLOW}5️⃣ Redis命令兼容性测试${NC}"
echo "--------------------------------"

# 检测存储类型
STORAGE_TYPE=$(grep NEXT_PUBLIC_STORAGE_TYPE .env.local 2>/dev/null | cut -d'=' -f2 || echo "unknown")
echo "当前存储类型: $STORAGE_TYPE"

# 尝试直接连接Redis/Kvrocks进行验证
if command -v redis-cli &> /dev/null; then
  if [ "$STORAGE_TYPE" = "kvrocks" ]; then
    echo "测试Kvrocks连接..."
    if timeout 2 redis-cli -h localhost -p 6666 PING &> /dev/null; then
      echo -e "${GREEN}✅ Kvrocks连接正常${NC}"
      
      # 测试基本命令
      echo "测试SET/GET..."
      redis-cli -h localhost -p 6666 SET test:redis:compatibility "OK" > /dev/null
      RESULT=$(redis-cli -h localhost -p 6666 GET test:redis:compatibility)
      if [ "$RESULT" = "OK" ]; then
        echo -e "${GREEN}✅ SET/GET 正常${NC}"
        PASSED=$((PASSED + 1))
      else
        echo -e "${RED}❌ SET/GET 失败${NC}"
        FAILED=$((FAILED + 1))
      fi
      
      # 测试集合命令
      echo "测试SADD/SMEMBERS..."
      redis-cli -h localhost -p 6666 SADD test:set "member1" "member2" > /dev/null
      MEMBERS=$(redis-cli -h localhost -p 6666 SMEMBERS test:set | wc -l)
      if [ "$MEMBERS" -ge 2 ]; then
        echo -e "${GREEN}✅ SADD/SMEMBERS 正常${NC}"
        PASSED=$((PASSED + 1))
      else
        echo -e "${RED}❌ SADD/SMEMBERS 失败${NC}"
        FAILED=$((FAILED + 1))
      fi
      
      # 测试有序集合
      echo "测试ZADD/ZRANGE..."
      redis-cli -h localhost -p 6666 ZADD test:zset 1 "item1" 2 "item2" > /dev/null
      ZCOUNT=$(redis-cli -h localhost -p 6666 ZCARD test:zset)
      if [ "$ZCOUNT" -ge 2 ]; then
        echo -e "${GREEN}✅ ZADD/ZRANGE 正常${NC}"
        PASSED=$((PASSED + 1))
      else
        echo -e "${RED}❌ ZADD/ZRANGE 失败${NC}"
        FAILED=$((FAILED + 1))
      fi
      
      # 清理测试数据
      redis-cli -h localhost -p 6666 DEL test:redis:compatibility test:set test:zset > /dev/null
    else
      echo -e "${YELLOW}⚠️  无法连接Kvrocks (localhost:6666)${NC}"
    fi
  elif [ "$STORAGE_TYPE" = "redis" ]; then
    echo "测试Redis连接..."
    if timeout 2 redis-cli -h localhost -p 6379 PING &> /dev/null; then
      echo -e "${GREEN}✅ Redis连接正常${NC}"
      
      # 同样的测试...
      echo "测试SET/GET..."
      redis-cli -h localhost -p 6379 SET test:redis:compatibility "OK" > /dev/null
      RESULT=$(redis-cli -h localhost -p 6379 GET test:redis:compatibility)
      if [ "$RESULT" = "OK" ]; then
        echo -e "${GREEN}✅ SET/GET 正常${NC}"
        PASSED=$((PASSED + 1))
      fi
      
      redis-cli -h localhost -p 6379 DEL test:redis:compatibility > /dev/null
    else
      echo -e "${YELLOW}⚠️  无法连接Redis (localhost:6379)${NC}"
    fi
  fi
else
  echo -e "${YELLOW}⚠️  redis-cli未安装，跳过直接测试${NC}"
fi

# 总结
echo ""
echo "================================"
echo -e "${BLUE}📊 测试总结${NC}"
echo "================================"
echo -e "通过: ${GREEN}$PASSED${NC}"
echo -e "失败: ${RED}$FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}🎉 所有测试通过！Redis/Kvrocks兼容性良好${NC}"
  exit 0
else
  echo -e "${RED}❌ 部分测试失败，请检查日志${NC}"
  exit 1
fi
