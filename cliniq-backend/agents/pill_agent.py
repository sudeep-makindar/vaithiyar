import base64
from services import llm

def run_vision_agent(image_base64: str, prescription_id: str) -> dict:
    print(f"Executing Vision Agent for prescription {prescription_id}...")
    try:
        # Remove data string header if present (e.g. data:image/jpeg;base64,...)
        if "," in image_base64:
            image_base64 = image_base64.split(",")[1]
            
        image_data = base64.b64decode(image_base64)
        
        prompt = '''
        You are a pharmaceutical identification AI. Examine this pill image carefully.
        Identify: shape (round/oval/capsule/other), primary color, any visible markings or imprints,
        approximate size (small/medium/large).
        Return ONLY a JSON object: {"shape": "round", "color": "white", "markings": "XYZ", "size": "small", "confidence_pct": 98}
        '''
        
        vision_result = llm.generate(prompt, images=[image_data], temperature=0.1)
        return { 'vision_result': vision_result, 'prescription_id': prescription_id }
        
    except Exception as e:
        print(f"Error executing Pill Vision Agent: {str(e)}")
        return { 'error': str(e), 'prescription_id': prescription_id }
