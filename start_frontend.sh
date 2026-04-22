#!/bin/bash

echo "Starting Online Voting System Frontend..."
echo ""

cd frontend

echo "Installing dependencies (if needed)..."
npm install

echo ""
echo "Starting React development server..."
npm run dev
