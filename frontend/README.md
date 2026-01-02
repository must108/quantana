# Quantana

This project is a development tool that allows users to monitor their quantum systems closely. It uses [Qiskit](https://www.ibm.com/quantum/qiskit) to simulate quantum system data, and is shown through a [React](https://react.dev/) frontend. All quantum data used is **synthetic**. You can view the project [here](https://quantana.mustaeen.dev).

## Prerequisites

**Node.js** (any version) \
**Python** 3.10+ \
**npm** \
**Visual Studio Code** (optional)

### Getting Started

Follow the steps below to start running this application locally!

```
git clone https://github.com/must108/quantana

cd backend
python -m venv .venv
.venv\Scripts\activate # windows
source .venv/bin/activate # mac/linux

pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000

cd ../frontend
npm install
npm run dev

```
