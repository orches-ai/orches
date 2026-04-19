from dotenv import load_dotenv
load_dotenv()

import os
import uvicorn

if __name__ == "__main__":
    dev = os.getenv("ORCHES_ENV", "development") != "production"
    uvicorn.run("api.main:app", host="0.0.0.0", port=8000, reload=dev)
