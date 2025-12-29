#!/bin/bash
# Quick script for Copilot to ask questions via terminal
# Usage: ./ask.sh "Your question here"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🤖 COPILOT QUESTION:"
echo "$1"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
read -p "Your answer: " answer
echo ""
echo ">>> $answer"
echo ""
